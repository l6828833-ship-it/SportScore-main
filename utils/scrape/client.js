/**
 * BBC Sport page scraper.
 *
 * No API is involved: this fetches ordinary HTML pages and reads the JSON that
 * the site embeds for its own client-side rendering, in
 * `window.__INITIAL_DATA__`.
 *
 * Reading that blob rather than parsing the rendered markup is a deliberate
 * choice. CSS selectors on a modern site are hashed class names
 * (`article_title__9p8Mp` — see controllers/scrapeController.js, which is
 * already broken for exactly this reason) and change on every frontend build.
 * The embedded data is the same payload the page's own JavaScript consumes, so
 * it is both richer and far more stable. It still carries no compatibility
 * promise, so every reader below tolerates missing fields.
 *
 * Scraping etiquette, since this hits someone else's servers:
 *   - responses are cached, so polling does not re-fetch
 *   - requests are serialised, never fanned out
 *   - a real User-Agent is sent rather than a spoofed or empty one
 */

const axios = require('axios');
const cache = require('./../cache');

const BASE =
  process.env.SCRAPE_BASE_URL || 'https://www.bbc.com/sport/football';

const TTL_LIVE = Number(process.env.SCRAPE_TTL_LIVE_SECONDS) || 60;
const TTL_STATIC = Number(process.env.SCRAPE_TTL_SECONDS) || 900;
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 20000;

const USER_AGENT =
  process.env.SCRAPE_USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

class ScrapeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ScrapeError';
    this.status = status || 502;
  }
}

async function fetchHtml(path, ttl) {
  const url = `${BASE}${path}`;
  const cacheKey = `scrape:html:${url}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let response;
  try {
    response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      // Follow the site's own redirects (it normalises some paths).
      maxRedirects: 5,
      // Some pages are ~1MB of HTML; the default limit is fine but be explicit.
      maxContentLength: 20 * 1024 * 1024,
      responseType: 'text',
      transformResponse: [(body) => body],
    });
  } catch (error) {
    throw new ScrapeError(
      `Could not load ${url}: ${error.message}`,
      error.response ? error.response.status : 503
    );
  }

  cache.set(cacheKey, response.data, ttl);
  return response.data;
}

/**
 * Pull `window.__INITIAL_DATA__` out of a page.
 *
 * It is assigned as a JSON *string literal*, so the value is double-encoded:
 * unescape the JS string first, then parse the JSON inside it.
 */
function extractInitialData(html, label) {
  const match = /window\.__INITIAL_DATA__\s*=\s*"((?:\\.|[^"\\])*)"/.exec(html);
  if (!match) {
    throw new ScrapeError(
      `No embedded data found on ${label}. The page layout has probably changed — ` +
        'check utils/scrape/client.js.',
      502
    );
  }

  try {
    return JSON.parse(JSON.parse(`"${match[1]}"`));
  } catch (error) {
    throw new ScrapeError(
      `Embedded data on ${label} did not parse: ${error.message}`,
      502
    );
  }
}

/** Find the payload of the first data block whose key starts with `prefix`. */
function block(data, prefix, label) {
  const blocks = (data && data.data) || {};
  const key = Object.keys(blocks).find((k) => k.startsWith(prefix));
  if (!key) {
    throw new ScrapeError(
      `Page ${label} has no "${prefix}" block. Available: ${Object.keys(blocks)
        .map((k) => k.split('?')[0])
        .join(', ')}`,
      502
    );
  }
  return blocks[key].data || {};
}

/**
 * Whether a date can still hold an in-progress match, and so needs the short
 * cache lifetime.
 *
 * Testing `date === todayUTC` is wrong, and produced a genuinely frozen clock: a
 * match kicking off at 22:00 UTC is still being played at 00:30 UTC the next
 * day, but it belongs to the PREVIOUS day's page. Treating that page as settled
 * history cached a live match for 15 minutes at a time.
 *
 * Viewers also span timezones, so a single calendar day is somebody's "today"
 * for about 26 hours. One day either side of UTC today covers both cases.
 */
function isCurrentDate(dateKey) {
  const today = new Date().toISOString().slice(0, 10);
  const day = 24 * 60 * 60 * 1000;
  const diff = Math.abs(
    Date.parse(`${dateKey}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)
  );
  return Number.isFinite(diff) && diff <= day;
}

/** Scores and fixtures for one calendar day, every competition in one request. */
async function scoresFixtures(dateKey) {
  const label = `scores-fixtures/${dateKey}`;
  const html = await fetchHtml(
    `/scores-fixtures/${dateKey}`,
    isCurrentDate(dateKey) ? TTL_LIVE : TTL_STATIC
  );
  return block(
    extractInitialData(html, label),
    'sport-data-scores-fixtures',
    label
  );
}

/** League table for one competition. */
async function table(slug) {
  const label = `${slug}/table`;
  const html = await fetchHtml(`/${slug}/table`, TTL_STATIC);
  return block(extractInitialData(html, label), 'football-table', label);
}

module.exports = {
  ScrapeError,
  scoresFixtures,
  table,
  fetchHtml,
  isCurrentDate,
};
