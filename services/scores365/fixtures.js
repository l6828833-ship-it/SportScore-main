/**
 * Fixtures from 365scores' public JSON API. No key.
 *
 * A date request returns every competition playing that day; a per-competition
 * request returns that league's upcoming and past games directly, so the league
 * page needs no day-by-day crawl.
 */

const client = require('../../utils/scores365/client');
const shape = require('../../utils/scores365/normalize');
const { resolve365Id, toExposedId } = require('../../utils/scores365/leagues');

const todayKey = () => new Date().toISOString().slice(0, 10);

function shiftDate(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

const IN_PLAY = new Set(['1H', '2H', 'HT', 'ET', 'P', 'PEN', 'LIVE', 'SUSP']);

/**
 * Exposed ids that are knockout competitions.
 *
 * The primary test, because it cannot be defeated by wording. `isCup` used to be
 * decided by an English regex over the competition's DISPLAY NAME — and the
 * display name is localized, so "كأس العالم" never matched /cup|world/ and the
 * World Cup was reported as a plain league. The consumer then showed no knockout
 * bracket for it.
 */
const CUP_IDS = new Set([
  1, //   FIFA World Cup
  2, //   UEFA Champions League
  3, //   UEFA Europa League
  848, // UEFA Conference League
  17, //  AFC Champions League Elite
  12, //  CAF Champions League
  13, //  CONMEBOL Libertadores
  11, //  CONMEBOL Sudamericana
  6, //   Africa Cup of Nations
  45, //  FA Cup
  48, //  EFL Cup
  143, // Copa del Rey
  137, // Coppa Italia
  81, //  DFB-Pokal
  66, //  Coupe de France
  // Arab domestic cups, on locally assigned ids — see utils/scores365/leagues.js.
  900001, // كأس الملك (Saudi)
  900002, // كأس مصر
  900003, // كأس العرش (Morocco)
  900004, // كأس رئيس الدولة (UAE)
  900005, // كأس أمير قطر
  900006, // كأس تونس
  900007, // كأس الجزائر
  900008, // كأس الأردن
  900009, // كأس العراق
]);

/**
 * A knockout STAGE name on any game also proves it, whatever the id.
 *
 * Matched in every language a consumer can ask for, so an unpinned cup is
 * still recognised: "دور الـ 16" / "ربع النهائي" under Arabic, "Round of 16" /
 * "Quarter Finals" under English. Most other languages' rounds contain "final"
 * ("Cuartos de Final", "Achtelfinale", "Çeyrek Final"); the rest are spelled
 * out as the source writes them — German "Zwischenrunde" for the round of 32,
 * Turkish "16 Round" and "Yari Finaller", Indonesian "Babak 16" and
 * "Putaran 32".
 */
const KNOCKOUT_STAGE =
  /final|semi|quarter|round of|1\/8|1\/4|نهائي|دور ال|zwischenrunde|\b16 round|son 32|yari f|babak 16|putaran 32/i;

function looksLikeCup(exposedId, game) {
  if (CUP_IDS.has(Number(exposedId))) return true;
  return KNOCKOUT_STAGE.test(game.stageName || '');
}

/**
 * Competition names in English, by 365scores id; empty if the catalogue is
 * unavailable.
 *
 * Consumers hide women's, youth, reserve and lower-division competitions from
 * a day's list by NAME, and their patterns are written for English (and
 * Arabic). Served in Spanish or Turkish, "Femenina" and "Kadınlar" would slip
 * through and bury the list, so a day asked for in a language carries each
 * competition's English name too. One catalogue request, cached like the rest.
 */
/**
 * Each competition's English name and its country's ISO code ("PT"), from
 * the catalogue (cached), so the app can filter by name and put the reader's
 * own country's leagues and cups first. International competitions have no
 * country and get null.
 */
async function englishNames() {
  try {
    const body = await client.competitions({ langId: '1' });
    const out = new Map();
    for (const c of body.competitions || []) {
      out.set(c.id, {
        name: c.name,
        countryCode: await client
          .isoForCountryId(c.countryId)
          .catch(() => null),
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

/**
 * Tells a client how old a game in play is: `status.ageMs`, the time since
 * 365scores produced it, through every cache on the way. The app starts its
 * running clock from when a minute turned, so it needs to know when the feed
 * SAW the turn, not when the copy arrived. Relative rather than a timestamp,
 * so the phone's clock being off does not matter. In-play games only.
 */
function withAge(fixture, asOf) {
  if (asOf > 0 && IN_PLAY.has(fixture.fixture.status.short)) {
    fixture.fixture.status.ageMs = Math.max(0, Date.now() - asOf);
  }
  return fixture;
}

/**
 * All games on a date, normalized.
 *
 * With `withEnglishNames`, each league also carries `nameEn` (see
 * `englishNames`). Only consumers that ask for a language get it, so the
 * website's requests, which send none, cost exactly what they did.
 */
async function fixturesForDate(
  dateKey,
  timezoneName,
  langId,
  withEnglishNames,
  maxAge,
) {
  // Yesterday is still live in the small hours: an evening kick-off in the
  // Americas is in play past midnight UTC, and on the 15-minute cache of a
  // settled day its goals would arrive a quarter of an hour late.
  const isToday =
    dateKey === todayKey() ||
    (dateKey === shiftDate(todayKey(), -1) && new Date().getUTCHours() < 6);
  const [feed, english] = await Promise.all([
    client.gamesOnDate(dateKey, {
      isToday,
      timezoneName,
      langId,
      // A settled day has nothing in play to keep fresh.
      maxAge: isToday ? maxAge : undefined,
    }),
    withEnglishNames ? englishNames() : Promise.resolve(null),
  ]);
  return (feed.games || []).map((g) => {
    const fixture = shape.fixture(g);
    if (english) {
      const entry = english.get(g.competitionId);
      fixture.league.nameEn = (entry && entry.name) || null;
      fixture.league.countryCode = (entry && entry.countryCode) || null;
    }
    // 365scores flags a game for a few minutes after the final whistle.
    if (g.justEnded) fixture.fixture.status.justEnded = true;
    withAge(fixture, feed._asOf);
    return fixture;
  });
}

/**
 * Mirrors API-Football's `/fixtures`. Supported: date, live, league, team, id.
 *
 * `lang` selects the language of the names in the response. It is forwarded, not
 * interpreted: every status, stage and event is classified from numeric ids or
 * from patterns that match every language served, so switching it changes the
 * text and nothing else. A day asked for in a language also carries each
 * competition's English name (`league.nameEn`).
 */
const getFixtures = async (params = {}) => {
  const timezoneName = params.timezoneName;
  const langId = client.resolveLangId(params.lang || params.langId);
  const withEnglishNames = Boolean(params.lang || params.langId);

  if (params.id || params.ids) {
    const one = await getFixtureById({
      id: params.id || params.ids,
      timezoneName,
      lang: params.lang,
      langId: params.langId,
      country: params.country,
    });
    return one && !one.error ? [one] : { error: 'Fixture not found' };
  }

  const live = String(params.live || '').toLowerCase();

  let fixtures;
  if (live) {
    // Yesterday + today, so a match straddling midnight is not lost.
    const today = todayKey();
    const pages = await Promise.all(
      [shiftDate(today, -1), today].map((d) =>
        fixturesForDate(
          d,
          timezoneName,
          langId,
          withEnglishNames,
          client.LIVE_MAX_AGE,
        ).catch(() => []),
      ),
    );
    /**
     * Games that have just ended are kept too, with their final status. A
     * reader following a match live learns from the live feed that it is
     * over, at the live feed's freshness — instead of from the match dropping
     * out of it, which sent the app to the whole day's list (cached longer)
     * and left the match showing "live", clock running, for half a minute
     * after the whistle.
     */
    fixtures = pages
      .flat()
      .filter(
        (f) =>
          IN_PLAY.has(f.fixture.status.short) || f.fixture.status.justEnded,
      );
  } else {
    fixtures = await fixturesForDate(
      String(params.date || todayKey()),
      timezoneName,
      langId,
      withEnglishNames,
    );
  }

  if (params.league) {
    const id = Number(params.league);
    fixtures = fixtures.filter((f) => f.league.id === id);
  }
  if (params.team) {
    const wanted = String(params.team);
    fixtures = fixtures.filter(
      (f) =>
        String(f.teams.home.id) === wanted ||
        String(f.teams.away.id) === wanted,
    );
  }

  const seen = new Set();
  fixtures = fixtures.filter((f) => {
    if (seen.has(f.fixture.id)) return false;
    seen.add(f.fixture.id);
    return true;
  });
  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0),
  );

  return fixtures.length > 0
    ? fixtures
    : { error: 'Empty data after multiple attempts' };
};

/** One fixture with goal events. 365scores' `/game` carries events + lineups. */
const getFixtureById = async (params = {}) => {
  const id = String(params.id || params.ids || params.fixture || '').trim();
  if (!id) return { error: 'An `id` query parameter is required' };

  let detail;
  let asOf;
  /**
   * Broadcasters are per country: `country` (ISO, "PT") asks for the
   * reader's own channels. Without it — the website — the default TV region.
   * A country with no known channels for the match gets none, rather than
   * another country's: beIN in Saudi Arabia means nothing in Portugal.
   */
  const tvCountryId = await client
    .countryIdFor(params.country)
    .catch(() => null);
  try {
    const payload = await client.game(id, {
      tvCountryId,
      timezoneName: params.timezoneName,
      langId: client.resolveLangId(params.lang || params.langId),
      // Read while it is being followed live; see LIVE_MAX_AGE.
      maxAge: client.LIVE_MAX_AGE,
    });
    detail = payload.game;
    asOf = payload._asOf;
  } catch {
    detail = null;
  }
  if (!detail) return { error: 'Fixture not found' };

  const base = withAge(shape.fixture(detail), asOf);
  return {
    ...base,
    events: shape.events(detail),
    // 365scores' free payload has lineups but no aggregated team match stats
    // in the same shape API-Football uses; left empty rather than half-filled.
    statistics: [],
    lineups: [],
  };
};

const getRounds = async () => ({
  error: 'Rounds are not available from the 365scores source',
});

/**
 * A competition's recent + upcoming matches (league page).
 *
 * Uses the two direct endpoints — results (past) and fixtures (upcoming) — so
 * this is two upstream calls regardless of the window, not a per-day crawl.
 */
const getLeagueFixtures = async (params = {}) => {
  const exposedId = Number(params.league);
  if (!Number.isFinite(exposedId)) {
    return { error: 'A numeric `league` id is required' };
  }
  const compId = await resolve365Id(exposedId);
  if (!compId) {
    return {
      error: `Competition ${exposedId} is not mapped for the 365scores source.`,
    };
  }

  const opts = {
    timezoneName: params.timezoneName,
    langId: client.resolveLangId(params.lang || params.langId),
  };
  const [resultsRes, fixturesRes] = await Promise.all([
    // The whole season, not the first page; see competitionSeasonResults.
    client.competitionSeasonResults(compId, opts).catch(() => ({ games: [] })),
    client.competitionFixtures(compId, opts).catch(() => ({ games: [] })),
  ]);

  const games = [...(resultsRes.games || []), ...(fixturesRes.games || [])];
  if (games.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  let name = null;
  let isCup = false;
  const seen = new Set();
  const fixtures = [];
  for (const g of games) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    name = name || g.competitionDisplayName;
    if (looksLikeCup(exposedId, g)) isCup = true;
    fixtures.push(shape.fixture(g));
  }
  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0),
  );

  return {
    league: {
      id: toExposedId(compId),
      name,
      country: null,
      type: isCup ? 'Cup' : 'League',
    },
    fixtures,
    updatedAt: Date.now(),
  };
};

module.exports = {
  getFixtures,
  getFixtureById,
  getRounds,
  getLeagueFixtures,
  fixturesForDate,
};
