/**
 * Upstream configuration.
 *
 * API-Football is reachable through two different gateways, and they do NOT
 * accept the same auth header. Getting this wrong fails silently — the API
 * answers HTTP 200 with an empty `response` and a populated `errors` object, so
 * a wrong header looks exactly like "this league has no fixtures today".
 *
 *   direct   https://v3.football.api-sports.io        header: x-apisports-key
 *   rapidapi https://api-football-v1.p.rapidapi.com/v3 headers: x-rapidapi-key
 *                                                             + x-rapidapi-host
 *
 * `API_PROVIDER` selects which. It is inferred from the host when unset, so an
 * existing deployment that only sets `key` keeps working.
 */

const DIRECT_URL = 'https://v3.football.api-sports.io';
const RAPIDAPI_URL = 'https://api-football-v1.p.rapidapi.com/v3';
const RAPIDAPI_HOST = 'api-football-v1.p.rapidapi.com';

const apiUrl = (process.env.API_BASE_URL || DIRECT_URL).replace(/\/+$/, '');

/** "rapidapi" | "direct" — explicit env wins, otherwise inferred from the host. */
const apiProvider = (() => {
  const explicit = (process.env.API_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'rapidapi' || explicit === 'direct') return explicit;
  return apiUrl.includes('rapidapi.com') ? 'rapidapi' : 'direct';
})();

/** Auth headers for the selected gateway. */
const authHeaders = () => {
  const key = process.env.key || process.env.API_FOOTBALL_KEY || '';
  if (apiProvider === 'rapidapi') {
    return {
      'x-rapidapi-key': key,
      'x-rapidapi-host': process.env.API_RAPIDAPI_HOST || RAPIDAPI_HOST,
    };
  }
  return { 'x-apisports-key': key };
};

const hasApiKey = () =>
  Boolean(process.env.key || process.env.API_FOOTBALL_KEY);

/**
 * Season used when a caller omits it. API-Football labels a season by its
 * STARTING year, so 2026 means 2026/2027.
 *
 * Note for free plans: api-sports.io restricts the free tier to a fixed set of
 * older seasons. If every season-scoped route comes back empty, this is the
 * first thing to check against your dashboard.
 */
const defaultSeason = (() => {
  const raw = Number(process.env.DEFAULT_SEASON);
  if (Number.isFinite(raw) && raw > 2000) return Math.round(raw);
  // Football seasons start mid-year: before July, the current season is still
  // the one that began last calendar year.
  const now = new Date();
  return now.getUTCMonth() + 1 >= 7
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
})();

const newsUrl = process.env.NEWS_URL || 'https://www.goal.com/en-us/news';

module.exports = {
  newsUrl,
  apiUrl,
  apiProvider,
  authHeaders,
  hasApiKey,
  defaultSeason,
  DIRECT_URL,
  RAPIDAPI_URL,
};
