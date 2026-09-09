/**
 * LiveScore public JSON API client. No key.
 *
 * LiveScore's own apps and site read from `prod-public-api.livescore.com`, which
 * returns structured JSON — no HTML scraping needed. One date request lists
 * EVERY competition playing that day (200+), which is far wider coverage than
 * the BBC scrape (Iraq, Saudi, CAF, and many more), and it carries team badge
 * URLs, scores, half-time scores, a live minute and goal incidents.
 *
 * Endpoints used (all verified live):
 *   date feed   /v1/api/app/date/soccer/YYYYMMDD/0   -> { Stages: [ ... ] }
 *   match       /v1/api/app/scoreboard/soccer/{id}   -> event incl. Incs-s goals
 *
 * Undocumented, so every reader tolerates missing fields, and requests are
 * cached and serialised as a courtesy.
 */

const axios = require('axios');
const cache = require('../cache');

const BASE =
  process.env.LIVESCORE_BASE_URL ||
  'https://prod-public-api.livescore.com/v1/api/app';

const TTL_LIVE = Number(process.env.LIVESCORE_TTL_LIVE_SECONDS) || 30;
const TTL_STATIC = Number(process.env.LIVESCORE_TTL_SECONDS) || 900;
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;
const USER_AGENT =
  process.env.LIVESCORE_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

class LiveScoreError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'LiveScoreError';
    this.status = status || 502;
  }
}

async function get(path, { ttl = TTL_STATIC, label = path } = {}) {
  const url = `${BASE}${path}`;
  const cacheKey = `livescore:${url}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let response;
  try {
    response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
  } catch (error) {
    throw new LiveScoreError(
      `LiveScore request failed for ${label}: ${error.message}`,
      error.response ? error.response.status : 503
    );
  }

  cache.set(cacheKey, response.data, ttl);
  return response.data;
}

/** "2026-09-13" -> "20260913" (LiveScore's date format). */
const toLsDate = (dateKey) => String(dateKey || '').replace(/-/g, '');

/** Every competition (Stage) with fixtures on a date. */
const dateFeed = (dateKey, isToday) =>
  get(`/date/soccer/${toLsDate(dateKey)}/0`, {
    ttl: isToday ? TTL_LIVE : TTL_STATIC,
    label: `date/${dateKey}`,
  });

/** One match with its goal incidents. */
const scoreboard = (eventId) =>
  get(`/scoreboard/soccer/${eventId}`, {
    ttl: TTL_LIVE,
    label: `scoreboard/${eventId}`,
  });

/**
 * A competition's league page, parsed for the data embedded in `__NEXT_DATA__`.
 *
 * Standings and the scorer leaderboard are not on the JSON API — they live in
 * the page LiveScore renders — but they are the SAME structured JSON the page's
 * own code consumes (`initialData.tables`, `initialData.playersGoalsStats`), so
 * reading it is stable and complete, not selector-scraping.
 *
 * `country`/`competition` are LiveScore's URL slugs (Ccd / Scd from the date
 * feed), e.g. "england" / "premier-league".
 */
const WEB_BASE =
  process.env.LIVESCORE_WEB_URL || 'https://www.livescore.com/en/football';

async function leaguePage(country, competition) {
  const url = `${WEB_BASE}/${country}/${competition}/`;
  const cacheKey = `livescore:page:${url}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let html;
  try {
    const response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      responseType: 'text',
      transformResponse: [(b) => b],
      maxRedirects: 5,
    });
    html = response.data;
  } catch (error) {
    throw new LiveScoreError(
      `LiveScore page failed for ${country}/${competition}: ${error.message}`,
      error.response ? error.response.status : 503
    );
  }

  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(
    html
  );
  if (!match) {
    throw new LiveScoreError(
      `No embedded data on ${country}/${competition} page.`,
      502
    );
  }
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (error) {
    throw new LiveScoreError(
      `Embedded data did not parse: ${error.message}`,
      502
    );
  }
  const initial =
    (data.props && data.props.pageProps && data.props.pageProps.initialData) ||
    {};
  cache.set(cacheKey, initial, TTL_STATIC);
  return initial;
}

module.exports = { LiveScoreError, dateFeed, scoreboard, leaguePage, toLsDate };
