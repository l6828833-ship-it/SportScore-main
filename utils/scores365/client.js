/**
 * 365scores public JSON API client. No key.
 *
 * 365scores' website and apps read from `webws.365scores.com/web`, which returns
 * structured JSON with no HTML scraping. It is the widest, richest free source
 * wired into this server:
 *   • one request lists every game on a date, with a real live clock and score;
 *   • standings, a FULL top-scorers AND top-assists leaderboard (20 deep, not a
 *     3-row preview), goal events with scorer + assist, lineups and venue.
 *
 * Every request carries the same base query params the site sends
 * (`appTypeId`, `langId`, `timezoneName`, `userCountryId`) and a browser-like
 * header set — without them the endpoint answers 406.
 *
 * Endpoints used (all verified live):
 *   games on a date   /games/current or /games/allscores?startDate=..&endDate=..
 *   comp fixtures     /games/fixtures?competitions=ID   (upcoming)
 *   comp results      /games/results?competitions=ID    (past)
 *   standings         /standings?competitions=ID
 *   player stats      /stats?competitions=ID             (goals, assists, ...)
 *   one game          /game?gameId=ID                    (events, lineups)
 *   competitions      /competitions?sports=1
 */

const axios = require('axios');
const cache = require('../cache');

const BASE =
  process.env.SCORES365_BASE_URL || 'https://webws.365scores.com/web';

const TTL_LIVE = Number(process.env.SCORES365_TTL_LIVE_SECONDS) || 30;
const TTL_STATIC = Number(process.env.SCORES365_TTL_SECONDS) || 900;
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;

const APP_TYPE_ID = process.env.SCORES365_APP_TYPE_ID || '5';
// 27 = Arabic. 365scores returns team, competition and stage names already in
// Arabic, which is what the (Arabic) frontend wants — and it covers
// competitions the app has no English->Arabic mapping for (e.g. the EFL Cup,
// which comes back as "كأس الكاراباو" rather than English). Override with
// SCORES365_LANG_ID (1 = English) if a consumer needs Latin names.
const LANG_ID = process.env.SCORES365_LANG_ID || '27';
// Match the language's primary region so localized names and the TV-network
// lookup are regionally consistent. 122 = Saudi Arabia.
const USER_COUNTRY_ID = process.env.SCORES365_USER_COUNTRY_ID || '122';
const DEFAULT_TZ = process.env.SCORES365_TIMEZONE || 'UTC';

/**
 * Country used for the TV-network lookup on `/game/`.
 *
 * Broadcast rights are territorial, so 365scores returns `tvNetworks` for the
 * COUNTRY it thinks is asking. With the default `userCountryId` of 1 the array
 * comes back empty — there is no channel to report for a viewer it cannot place.
 * Asking as a MENA country returns the beIN assignment, which is the region this
 * server's consumers cover.
 *
 * 122 is Saudi Arabia. Every MENA id tested (Qatar 115, Egypt 131, Tunisia 135,
 * Algeria 139) returns the same beIN channel for a given match, so the specific
 * choice only matters if you need a different region — override with
 * SCORES365_TV_COUNTRY_ID.
 *
 * Kept separate from USER_COUNTRY_ID so switching the TV region cannot quietly
 * alter anything else the id influences.
 */
const TV_COUNTRY_ID = process.env.SCORES365_TV_COUNTRY_ID || '122';

const USER_AGENT =
  process.env.SCORES365_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

class Scores365Error extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'Scores365Error';
    this.status = status || 502;
  }
}

/** Merge the site's mandatory query params with the caller's, caller wins. */
function withCommon(params = {}) {
  return {
    appTypeId: APP_TYPE_ID,
    langId: LANG_ID,
    timezoneName: params.timezoneName || DEFAULT_TZ,
    userCountryId: USER_COUNTRY_ID,
    ...params,
  };
}

/** Build a stable cache key from a path and its sorted params. */
function keyFor(path, params) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return `scores365:${path}?${sorted}`;
}

async function get(path, params = {}, { ttl = TTL_STATIC } = {}) {
  const query = withCommon(params);
  const cacheKey = keyFor(path, query);
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let response;
  try {
    response = await axios.get(`${BASE}${path}`, {
      params: query,
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        // 365scores answers 406 without a same-site referer.
        Referer: 'https://www.365scores.com/',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (error) {
    throw new Scores365Error(
      `365scores request failed for ${path}: ${error.message}`,
      error.response ? error.response.status : 503
    );
  }

  cache.set(cacheKey, response.data, ttl);
  return response.data;
}

/** "2026-09-13" -> "13/09/2026" (365scores' date format for allscores). */
const toApiDate = (dateKey) => {
  const [y, m, d] = String(dateKey || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
};

/**
 * Every game on a specific date.
 *
 * Always uses `/games/allscores` with an explicit start/end date. The
 * `/games/current` endpoint was tempting for "today", but it returns a rolling
 * window centred on NOW — yesterday's finished games plus today's — and is
 * capped at 100, so asking it for "today" yields mostly yesterday's slate. The
 * dated `allscores` call returns exactly the requested day, in full. Today's
 * request still gets the short live TTL so scores stay fresh.
 */
const gamesOnDate = (dateKey, { isToday, timezoneName } = {}) => {
  const date = toApiDate(dateKey);
  return get(
    '/games/allscores/',
    { sports: 1, startDate: date, endDate: date, timezoneName },
    { ttl: isToday ? TTL_LIVE : TTL_STATIC }
  );
};

/** Upcoming games for a competition. */
const competitionFixtures = (competitionId, { timezoneName } = {}) =>
  get('/games/fixtures/', { competitions: competitionId, timezoneName });

/** Past games for a competition. */
const competitionResults = (competitionId, { timezoneName } = {}) =>
  get('/games/results/', { competitions: competitionId, timezoneName });

/** League table for a competition. */
const standings = (competitionId, { timezoneName } = {}) =>
  get('/standings/', { competitions: competitionId, timezoneName });

/** Player stat leaderboards (goals, assists, ...) for a competition. */
const stats = (competitionId, { timezoneName } = {}) =>
  get('/stats/', { competitions: competitionId, timezoneName });

/**
 * One game with events, lineups, venue and TV networks. Short TTL: it may be live.
 *
 * `userCountryId` is overridden to the TV region here. This is the only endpoint
 * that returns `tvNetworks` — the games list carries just a `hasTVNetworks`
 * boolean — so a per-match channel is only obtainable through this call.
 */
const game = (gameId, { timezoneName } = {}) =>
  get(
    '/game/',
    { gameId, timezoneName, userCountryId: TV_COUNTRY_ID },
    { ttl: TTL_LIVE }
  );

/** Every competition 365scores tracks, used to build the id map / catalogue. */
const competitions = () => get('/competitions/', { sports: 1 });

module.exports = {
  Scores365Error,
  gamesOnDate,
  competitionFixtures,
  competitionResults,
  standings,
  stats,
  game,
  competitions,
};
