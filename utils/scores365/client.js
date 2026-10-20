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
/**
 * How stale a live read may be. The app polls a match in play every 10 s and
 * runs its seconds clock from the moment the minute changes, so a 30-second
 * cached copy would put that clock up to half a minute behind. Only the live
 * reads ask for this; the website's day pages keep the 30-second cache.
 */
const LIVE_MAX_AGE = Number(process.env.SCORES365_LIVE_MAX_AGE_SECONDS) || 5;
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;

const APP_TYPE_ID = process.env.SCORES365_APP_TYPE_ID || '5';
// 27 = Arabic. 365scores returns team, competition and stage names already in
// Arabic, which is what the (Arabic) website wants — and it covers competitions
// the app has no English->Arabic mapping for (e.g. the EFL Cup, which comes back
// as "كأس الكاراباو" rather than English). Still the DEFAULT, so a consumer that
// sends nothing keeps the behaviour it has today; override the default with
// SCORES365_LANG_ID, or per request with `?lang=`.
const LANG_ID = process.env.SCORES365_LANG_ID || '27';

/**
 * 365scores language ids, by ISO 639-1 code: the languages this server's
 * consumers use. Names are localized by the SOURCE, so the language is chosen
 * per REQUEST rather than per deployment: the website is Arabic, the Android
 * app ships in nine languages, and one process serves both.
 *
 * 365scores publishes no list. Each id was identified from the live feed by
 * how it names Germany ("Alemania", "Allemagne", "Deutschland", "Germania",
 * "Alemanha", "Almanya", "Jerman") and the World Cup, because many neighbouring
 * ids are near-duplicates (14 is Spain's Spanish, 29 Latin America's; 31 is
 * Brazil's Portuguese, 30 Portugal's; 36 is Romanian, not Italian). The app's
 * Portuguese is Brazilian, hence 31. Indonesian is accepted as both `id` and
 * Android's legacy `in`.
 *
 * Unknown codes fall back to the default rather than erroring. A reader whose
 * language is not translated is better served Arabic names than a 400.
 */
const LANG_IDS = {
  ar: '27',
  en: '1',
  es: '14',
  fr: '15',
  de: '16',
  it: '12',
  pt: '31',
  tr: '33',
  id: '34',
  in: '34',
};

/**
 * Resolves a consumer's `lang` into a 365scores `langId`.
 *
 * Accepts either form, so `?lang=en`, `?lang=en-GB` and `?langId=1` all work —
 * a client sending a full BCP 47 tag (which `Locale.getDefault().language` on
 * Android will not, but a browser's `navigator.language` does) should not
 * silently get Arabic.
 */
function resolveLangId(lang) {
  if (lang === undefined || lang === null || lang === '') return LANG_ID;
  const text = String(lang).trim().toLowerCase();
  if (/^\d+$/.test(text)) return text;
  return LANG_IDS[text.split(/[-_]/)[0]] || LANG_ID;
}
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

/**
 * Merge the site's mandatory query params with the caller's, caller wins.
 *
 * `langId` is resolved AFTER the spread, not left to it. Every method below
 * passes `langId` through from its options, so an absent one arrives here as
 * `undefined` — and `...params` would happily overwrite the default with it.
 * 365scores answers 406 when a mandatory param goes missing, so that would turn
 * "the caller didn't specify a language" into a dead endpoint.
 */
function withCommon(params = {}) {
  return {
    appTypeId: APP_TYPE_ID,
    timezoneName: params.timezoneName || DEFAULT_TZ,
    userCountryId: USER_COUNTRY_ID,
    ...params,
    langId: resolveLangId(params.langId),
  };
}

/** Is `key` absent or an empty array on this payload? */
function isEmptyList(body, key) {
  if (!body || typeof body !== 'object') return true;
  const value = body[key];
  return !Array.isArray(value) || value.length === 0;
}

/** Build a stable cache key from a path and its sorted params. */
function keyFor(path, params) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return `scores365:${path}?${sorted}`;
}

/**
 * One request, with the encoding we ask for.
 *
 * `acceptEncoding` is explicit because it changes the ANSWER, not just the
 * transfer — see the retry in `get` below.
 */
function request(path, query, acceptEncoding) {
  return axios.get(`${BASE}${path}`, {
    params: query,
    timeout: TIMEOUT_MS,
    // Undo axios's automatic gzip handling when asking for identity, or it
    // re-adds its own Accept-Encoding and the header we set is ignored.
    decompress: acceptEncoding !== 'identity',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      // 365scores answers 406 without a same-site referer.
      Referer: 'https://www.365scores.com/',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': acceptEncoding,
    },
  });
}

/**
 * @param expect Name of an array the payload must contain a non-empty value for.
 *   When it comes back missing or empty, the request is retried UNCOMPRESSED —
 *   see below for why that is not as silly as it looks.
 * @param maxAge Seconds. A cached copy older than this is refetched although
 *   its `ttl` has not run out: for a caller that needs a resource fresher than
 *   its other readers do (see `LIVE_MAX_AGE`), without shortening the cache
 *   for all of them.
 */
async function get(
  path,
  params = {},
  { ttl = TTL_STATIC, expect, maxAge } = {},
) {
  const query = withCommon(params);
  const cacheKey = keyFor(path, query);
  const hit = cache.get(cacheKey);
  if (hit && !(maxAge > 0 && Date.now() - hit.at > maxAge * 1000)) {
    return hit.data;
  }
  // Callers that arrive together share one upstream call.
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const pending = fetchAndCache(path, query, cacheKey, ttl, expect);
  inFlight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * Requests to 365scores in progress, by cache key, so that the readers of a
 * resource that expire together do not each make their own call.
 */
const inFlight = new Map();

async function fetchAndCache(path, query, cacheKey, ttl, expect) {
  let response;
  try {
    response = await request(path, query, 'gzip, deflate, br');

    /**
     * Retry without compression when the payload came back empty.
     *
     * 365scores' edge serves DIFFERENT CONTENT for the compressed and
     * uncompressed variants of the same URL. Verified on the World Cup's results:
     * the identical query returns 89 games with `Accept-Encoding: identity` and 0
     * games with gzip, reproducibly, while the Champions League and CAF return 18
     * and 58 either way. So it is a per-resource fault in their cache, not
     * something about the query — which is why it cannot be fixed by changing
     * what we ask for.
     *
     * The effect was a competition with a full history of results reporting none:
     * the World Cup's matches tab was empty, and the computed leaderboards and
     * knockout bracket that read the same feed had nothing to work from.
     *
     * Compression stays the default because these payloads are large (190 KB
     * uncompressed for one competition) and almost all of them are served
     * correctly. The retry only costs a second request on the rare resource that
     * is broken, and it self-heals if the fault moves to another one.
     */
    if (expect && isEmptyList(response.data, expect)) {
      const plain = await request(path, query, 'identity').catch(() => null);
      if (plain && !isEmptyList(plain.data, expect)) response = plain;
    }
  } catch (error) {
    throw new Scores365Error(
      `365scores request failed for ${path}: ${error.message}`,
      error.response ? error.response.status : 503,
    );
  }

  /**
   * When 365scores produced this copy. Their CDN serves the same answer for
   * up to 12 s (`Cache-Control: max-age=12`) and says how old it is in `Age`,
   * so "now" is not the answer's time. Kept on the payload as `_asOf` (epoch
   * ms) so a live reader can tell its clients how old the score is.
   */
  const age = Number(response.headers && response.headers.age) || 0;
  const asOf = Date.now() - age * 1000;
  if (response.data && typeof response.data === 'object') {
    response.data._asOf = asOf;
  }
  cache.set(cacheKey, { data: response.data, at: asOf }, ttl);
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
const gamesOnDate = (
  dateKey,
  { isToday, timezoneName, langId, maxAge } = {},
) => {
  const date = toApiDate(dateKey);
  return get(
    '/games/allscores/',
    { sports: 1, startDate: date, endDate: date, timezoneName, langId },
    { ttl: isToday ? TTL_LIVE : TTL_STATIC, expect: 'games', maxAge },
  );
};

/** Upcoming games for a competition. */
const competitionFixtures = (competitionId, { timezoneName, langId } = {}) =>
  get(
    '/games/fixtures/',
    { competitions: competitionId, timezoneName, langId },
    { expect: 'games' },
  );

/** Past games for a competition. */
const competitionResults = (competitionId, { timezoneName, langId } = {}) =>
  get(
    '/games/results/',
    { competitions: competitionId, timezoneName, langId },
    { expect: 'games' },
  );

/** Most pages of results `competitionSeasonResults` reads: a 16-team season. */
const MAX_RESULT_PAGES = Number(process.env.SCORES365_MAX_RESULT_PAGES) || 16;

/**
 * Every result of a competition's CURRENT season, newest first.
 *
 * `/games/results` is paged: one call returns only the latest ~16 games, with
 * a `paging.previousPage` link to the ones before. Reading just the first page
 * dropped everything older — two rounds into a season, a team page showed two
 * results beside a table that counted three played, and the missing one was
 * often the win. This follows the links back until the season changes (or
 * there are no more pages), so the results agree with the table.
 *
 * Older pages never change, so each is cached on its own for the static TTL
 * and a refresh normally costs only the first page.
 */
async function competitionSeasonResults(
  competitionId,
  { timezoneName, langId } = {},
) {
  const first = await competitionResults(competitionId, {
    timezoneName,
    langId,
  });
  const games = [...(first.games || [])];
  const season = games.length ? games[0].seasonNum : null;
  let link = first.paging && first.paging.previousPage;
  for (let page = 1; link && page < MAX_RESULT_PAGES; page += 1) {
    if (games.some((g) => g.seasonNum !== season)) break;
    const params = pageParams(link);
    if (!params) break;
    let body;
    try {
      body = await get('/games/', { ...params, timezoneName, langId });
    } catch {
      break; // Keep what has been read; a missing old page is not an outage.
    }
    const older = body.games || [];
    if (older.length === 0) break;
    games.push(...older);
    link = body.paging && body.paging.previousPage;
  }
  return {
    ...first,
    games: season == null ? games : games.filter((g) => g.seasonNum === season),
  };
}

/**
 * The query of a 365scores paging link ("/web/games/?…&aftergame=…"), minus
 * the language, region and time zone it was issued for — `get` puts the
 * caller's own back.
 */
function pageParams(link) {
  try {
    const url = new URL(link, 'https://webws.365scores.com');
    const params = Object.fromEntries(url.searchParams);
    for (const k of [
      'langId',
      'timezoneId',
      'timezoneName',
      'userCountryId',
      'apptype',
      'appTypeId',
    ]) {
      delete params[k];
    }
    return params.aftergame ? params : null;
  } catch {
    return null;
  }
}

/** League table for a competition. */
const standings = (competitionId, { timezoneName, langId } = {}) =>
  get(
    '/standings/',
    { competitions: competitionId, timezoneName, langId },
    { expect: 'standings' },
  );

/** Player stat leaderboards (goals, assists, ...) for a competition. */
const stats = (competitionId, { timezoneName, langId } = {}) =>
  get('/stats/', { competitions: competitionId, timezoneName, langId });

/**
 * How long a FINISHED game's detail is kept.
 *
 * A finished game's events, lineups and score never change again, so the live
 * TTL is pure waste for one — and it is not a small waste: the cup leaderboards
 * are computed by reading every finished league-phase game, so a 30-second
 * lifetime meant re-fetching the entire season's games every half minute. With
 * a full Champions League league phase (~180 games) that fan-out alone outruns
 * the caller's request budget. Callers opt in by passing `finished: true`.
 */
const TTL_FINISHED =
  Number(process.env.SCORES365_TTL_FINISHED_SECONDS) || 86400;

/**
 * One game with events, lineups, venue and TV networks. Short TTL by default:
 * it may be live. Pass `finished: true` for a game that has already ended to
 * cache it for a day instead, or `maxAge` for a reader that is following it
 * live.
 *
 * `userCountryId` is overridden to the TV region here. This is the only endpoint
 * that returns `tvNetworks` — the games list carries just a `hasTVNetworks`
 * boolean — so a per-match channel is only obtainable through this call.
 */
const game = (
  gameId,
  { timezoneName, langId, finished = false, maxAge, tvCountryId } = {},
) =>
  get(
    '/game/',
    {
      gameId,
      timezoneName,
      langId,
      userCountryId: tvCountryId || TV_COUNTRY_ID,
    },
    { ttl: finished ? TTL_FINISHED : TTL_LIVE, maxAge },
  );

/**
 * 365scores' own country ids where its English name differs from the ISO
 * name ("USA", "UAE"…), found by comparing the two lists. GB is the UK as a
 * whole (166): England (1) is 365scores' "no country", which has no channels.
 */
const COUNTRY_OVERRIDES = {
  GB: 166,
  US: 18,
  AE: 124,
  TW: 179,
  HK: 79,
  CI: 74,
  MM: 55,
  KN: 215,
  PH: 200,
  TT: 148,
  TC: 253,
};

const foldName = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');

let countryIds = null;

/**
 * 365scores' country id for an ISO 3166 code ("PT" -> 11), or null. Built
 * once from its country list, matched by English name, plus the overrides.
 */
async function countryIdFor(iso) {
  const code = String(iso || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  if (COUNTRY_OVERRIDES[code]) return String(COUNTRY_OVERRIDES[code]);
  if (!countryIds) {
    // In English: the names are matched against English region names.
    const body = await get('/countries/', { langId: '1' }, { ttl: 7 * 86400 });
    const byName = new Map(
      (body.countries || [])
        .filter((c) => !c.isInternational && !c.isNotReal)
        .map((c) => [foldName(c.name), String(c.id)]),
    );
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    const map = new Map();
    for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        let name;
        try {
          name = names.of(a + b);
        } catch {
          continue;
        }
        const id = byName.get(foldName(name));
        if (id) map.set(a + b, id);
      }
    }
    countryIds = map;
  }
  return countryIds.get(code) || null;
}

/**
 * Every football competition 365scores tracks (about 800), used to build the
 * id map / catalogue. `langId` picks the language of the names; without it the
 * default applies, as before.
 */
const competitions = ({ langId } = {}) =>
  get('/competitions/', { sports: 1, langId });

/**
 * Teams, competitions, players and countries whose name matches `query`, every
 * sport mixed. The match is across languages — "real" finds "ريال مدريد" in
 * Arabic and "ريال" finds "Real Madrid" in English — and the names come back
 * in `langId`. Two letters are enough.
 */
const search = (query, { timezoneName, langId } = {}) =>
  get('/search/', { query, timezoneName, langId }, { ttl: TTL_STATIC });

module.exports = {
  Scores365Error,
  LIVE_MAX_AGE,
  countryIdFor,
  resolveLangId,
  gamesOnDate,
  competitionFixtures,
  competitionResults,
  competitionSeasonResults,
  standings,
  stats,
  game,
  competitions,
  search,
};
