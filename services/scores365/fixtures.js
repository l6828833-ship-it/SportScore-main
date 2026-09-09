/**
 * Fixtures from 365scores' public JSON API. No key.
 *
 * A date request returns every competition playing that day; a per-competition
 * request returns that league's upcoming and past games directly, so the league
 * page needs no day-by-day crawl.
 */

const client = require('../../utils/scores365/client');
const shape = require('../../utils/scores365/normalize');
const { to365Id, toExposedId } = require('../../utils/scores365/leagues');

const todayKey = () => new Date().toISOString().slice(0, 10);

function shiftDate(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

const IN_PLAY = new Set(['1H', '2H', 'HT', 'ET', 'P', 'PEN', 'LIVE', 'SUSP']);

/** All games on a date, normalized. */
async function fixturesForDate(dateKey, timezoneName) {
  const isToday = dateKey === todayKey();
  const feed = await client.gamesOnDate(dateKey, { isToday, timezoneName });
  return (feed.games || []).map((g) => shape.fixture(g));
}

/**
 * Mirrors API-Football's `/fixtures`. Supported: date, live, league, team, id.
 */
const getFixtures = async (params = {}) => {
  const timezoneName = params.timezoneName;

  if (params.id || params.ids) {
    const one = await getFixtureById({
      id: params.id || params.ids,
      timezoneName,
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
        fixturesForDate(d, timezoneName).catch(() => [])
      )
    );
    fixtures = pages.flat().filter((f) => IN_PLAY.has(f.fixture.status.short));
  } else {
    fixtures = await fixturesForDate(
      String(params.date || todayKey()),
      timezoneName
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
        String(f.teams.home.id) === wanted || String(f.teams.away.id) === wanted
    );
  }

  const seen = new Set();
  fixtures = fixtures.filter((f) => {
    if (seen.has(f.fixture.id)) return false;
    seen.add(f.fixture.id);
    return true;
  });
  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0)
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
  try {
    detail = (await client.game(id, { timezoneName: params.timezoneName }))
      .game;
  } catch {
    detail = null;
  }
  if (!detail) return { error: 'Fixture not found' };

  const base = shape.fixture(detail);
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
  const compId = to365Id(exposedId);
  if (!compId) {
    return {
      error: `Competition ${exposedId} is not mapped for the 365scores source.`,
    };
  }

  const opts = { timezoneName: params.timezoneName };
  const [resultsRes, fixturesRes] = await Promise.all([
    client.competitionResults(compId, opts).catch(() => ({ games: [] })),
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
    if (
      /cup|champions|europa|conference|world|libertadores|nations/i.test(
        g.competitionDisplayName || ''
      )
    ) {
      isCup = true;
    }
    fixtures.push(shape.fixture(g));
  }
  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0)
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
