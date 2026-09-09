/**
 * ESPN public JSON client.
 *
 * No key, no quota, no rate-limit headers. Responses are still cached, because
 * the app polls and there is no reason to re-fetch an unchanged fixture list —
 * but the TTLs can be far shorter than API-Football's, since a cache miss costs
 * nothing but latency.
 *
 * These endpoints are undocumented. They are stable enough that a lot of
 * software depends on them, but they carry no compatibility promise, so every
 * reader here tolerates missing fields rather than assuming a shape.
 */

const axios = require('axios');
const cache = require('../cache');

const SITE_API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const WEB_API = 'https://site.web.api.espn.com/apis';

const TTL_LIVE = Number(process.env.ESPN_TTL_LIVE_SECONDS) || 60;
const TTL_STATIC = Number(process.env.ESPN_TTL_SECONDS) || 900;
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;

class EspnError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'EspnError';
    this.status = status || 502;
  }
}

async function get(url, { params = {}, ttl = TTL_STATIC, label = url } = {}) {
  const cacheKey = `espn:${url}-${JSON.stringify(params)}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let response;
  try {
    response = await axios.get(url, {
      params,
      timeout: TIMEOUT_MS,
      // ESPN rejects some default clients; a browser-ish UA is enough.
      headers: { Accept: 'application/json', 'User-Agent': 'SportScore/1.0' },
    });
  } catch (error) {
    // A single competition 400ing (ESPN does this for slugs it has retired)
    // must not fail a whole multi-competition scan, so the caller decides.
    throw new EspnError(
      `ESPN request failed for ${label}: ${error.message}`,
      error.response ? error.response.status : 503
    );
  }

  cache.set(cacheKey, response.data, ttl);
  return response.data;
}

/** "2026-09-08" -> "20260908" (ESPN's `dates` format). */
const toEspnDate = (dateKey) => String(dateKey || '').replace(/-/g, '');

const scoreboard = (slug, dateKey) =>
  get(`${SITE_API}/${slug}/scoreboard`, {
    params: dateKey ? { dates: toEspnDate(dateKey) } : {},
    // Today's board carries live scores, so it gets the short TTL.
    ttl: dateKey ? TTL_STATIC : TTL_LIVE,
    label: `${slug}/scoreboard`,
  });

const summary = (slug, eventId) =>
  get(`${SITE_API}/${slug}/summary`, {
    params: { event: eventId },
    ttl: TTL_LIVE,
    label: `${slug}/summary/${eventId}`,
  });

const standings = (slug, season) =>
  get(
    `${SITE_API.replace('/site/v2/sports', '/v2/sports')}/${slug}/standings`,
    {
      params: season ? { season } : {},
      ttl: TTL_STATIC,
      label: `${slug}/standings`,
    }
  );

const teams = (slug) =>
  get(`${SITE_API}/${slug}/teams`, { ttl: TTL_STATIC, label: `${slug}/teams` });

const teamSchedule = (slug, teamId) =>
  get(`${SITE_API}/${slug}/teams/${teamId}/schedule`, {
    ttl: TTL_STATIC,
    label: `${slug}/teams/${teamId}/schedule`,
  });

const searchPlayers = (query, limit = 20) =>
  get(`${WEB_API}/search/v2`, {
    params: { query, limit, sport: 'soccer' },
    ttl: 24 * 60 * 60,
    label: `search/${query}`,
  });

/**
 * Run many requests with a concurrency ceiling.
 *
 * A date scan touches ~30 competitions. Firing them all at once invites
 * connection resets and gets nothing back faster, so they go out in batches.
 * Individual failures resolve to null instead of rejecting, because one retired
 * competition slug must not empty the whole fixture list.
 */
async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        console.error(`[espn] ${error.message}`);
        results[index] = null;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runner)
  );
  return results;
}

module.exports = {
  EspnError,
  scoreboard,
  summary,
  standings,
  teams,
  teamSchedule,
  searchPlayers,
  mapLimited,
  toEspnDate,
};
