/**
 * Fixtures from LiveScore's public JSON API. No key.
 *
 * One date request returns every competition playing that day, so a whole day
 * of fixtures across 200+ competitions is a single upstream call — the same
 * one-request-per-day advantage as the BBC scrape, but with far wider coverage.
 */

const client = require('../../utils/livescore/client');
const shape = require('../../utils/livescore/normalize');
const { resolveStage } = require('../../utils/livescore/leagues');

const todayKey = () => new Date().toISOString().slice(0, 10);

function shiftDate(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/** eventId -> the date it was seen on, so a detail lookup knows where to look. */
const dateIndex = new Map();
const INDEX_MAX = 20000;
function remember(id, dateKey) {
  if (dateIndex.size > INDEX_MAX) dateIndex.clear();
  dateIndex.set(String(id), dateKey);
}

/** Flatten a date feed's Stages -> fixtures. */
function flatten(feed, dateKey) {
  const fixtures = [];
  for (const stage of feed.Stages || []) {
    const desc = resolveStage(stage);
    for (const event of stage.Events || []) {
      const f = shape.fixture(event, desc, stage);
      remember(f.fixture.id, dateKey);
      fixtures.push(f);
    }
  }
  return fixtures;
}

async function fixturesForDate(dateKey) {
  const feed = await client.dateFeed(dateKey, dateKey === todayKey());
  return flatten(feed, dateKey);
}

const IN_PLAY = new Set(['1H', '2H', 'HT', 'ET', 'PEN', 'SUSP']);

/**
 * Mirrors API-Football's `/fixtures`. Supported: date, live, league, team, id.
 */
const getFixtures = async (params = {}) => {
  if (params.id || params.ids) {
    const one = await getFixtureById({ id: params.id || params.ids });
    return one && !one.error ? [one] : { error: 'Fixture not found' };
  }

  const live = String(params.live || '').toLowerCase();

  let fixtures;
  if (live) {
    // Yesterday + today, so a match straddling UTC midnight is not lost.
    const today = todayKey();
    const pages = await Promise.all(
      [shiftDate(today, -1), today].map((d) =>
        fixturesForDate(d).catch(() => [])
      )
    );
    fixtures = pages.flat().filter((f) => IN_PLAY.has(f.fixture.status.short));
  } else {
    fixtures = await fixturesForDate(String(params.date || todayKey()));
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

  // De-dupe across the midnight boundary and sort.
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

const SEARCH_WINDOW_DAYS =
  Number(process.env.LIVESCORE_SEARCH_WINDOW_DAYS) || 3;

/** One fixture with goal incidents, via the scoreboard endpoint. */
const getFixtureById = async (params = {}) => {
  const id = String(params.id || params.ids || params.fixture || '').trim();
  if (!id) return { error: 'An `id` query parameter is required' };

  let sb;
  try {
    sb = await client.scoreboard(id);
  } catch {
    sb = null;
  }

  // The scoreboard payload is a bare event; find its stage from the date feed
  // it was seen on so the league is named. Fall back to a shallow record.
  const dateKey = dateIndex.get(id);
  let stageDesc = { id: 0, name: null, country: null };
  let stage = null;

  if (dateKey) {
    try {
      const feed = await client.dateFeed(dateKey, dateKey === todayKey());
      for (const s of feed.Stages || []) {
        if ((s.Events || []).some((e) => String(e.Eid) === id)) {
          stage = s;
          stageDesc = resolveStage(s);
          break;
        }
      }
    } catch {
      // fall through
    }
  }

  // If the scoreboard failed but we know the date, rebuild from the feed.
  if (!sb && dateKey) {
    try {
      const feed = await client.dateFeed(dateKey, dateKey === todayKey());
      for (const s of feed.Stages || []) {
        const e = (s.Events || []).find((x) => String(x.Eid) === id);
        if (e) {
          const base = shape.fixture(e, resolveStage(s), s);
          return { ...base, events: [], statistics: [], lineups: [] };
        }
      }
    } catch {
      // fall through
    }
  }

  // Cold lookup: scan a small window if we still don't have the stage.
  if (!stage && !sb) {
    const today = todayKey();
    for (let i = 0; i <= SEARCH_WINDOW_DAYS; i++) {
      for (const dk of [shiftDate(today, -i), shiftDate(today, i)]) {
        try {
          const feed = await client.dateFeed(dk, dk === today);
          for (const s of feed.Stages || []) {
            const e = (s.Events || []).find((x) => String(x.Eid) === id);
            if (e) {
              remember(id, dk);
              const base = shape.fixture(e, resolveStage(s), s);
              return { ...base, events: [], statistics: [], lineups: [] };
            }
          }
        } catch {
          // skip
        }
      }
    }
  }

  if (!sb) return { error: 'Fixture not found' };

  const base = shape.fixture(sb, stageDesc, stage);
  return {
    ...base,
    events: shape.events(sb),
    // LiveScore's public feed carries no team match-statistics or lineups here.
    statistics: [],
    lineups: [],
  };
};

const getRounds = async () => ({
  error: 'Rounds are not available from the LiveScore source',
});

/** A competition's recent + upcoming matches across a window (league page). */
const LEAGUE_PAST = Number(process.env.LIVESCORE_LEAGUE_PAST_DAYS) || 14;
const LEAGUE_FUTURE = Number(process.env.LIVESCORE_LEAGUE_FUTURE_DAYS) || 14;
const LEAGUE_CONCURRENCY =
  Number(process.env.LIVESCORE_LEAGUE_CONCURRENCY) || 6;

const getLeagueFixtures = async (params = {}) => {
  const id = Number(params.league);
  if (!Number.isFinite(id)) {
    return { error: 'A numeric `league` id is required' };
  }

  const past = Math.max(0, Number(params.past) || LEAGUE_PAST);
  const future = Math.max(0, Number(params.future) || LEAGUE_FUTURE);
  const today = todayKey();
  const dates = [];
  for (let i = past; i >= 1; i--) dates.push(shiftDate(today, -i));
  for (let i = 0; i <= future; i++) dates.push(shiftDate(today, i));

  const collected = [];
  let name = null;
  let country = null;
  let isCup = false;
  let cursor = 0;
  const worker = async () => {
    while (cursor < dates.length) {
      const dk = dates[cursor++];
      try {
        const feed = await client.dateFeed(dk, dk === today);
        for (const stage of feed.Stages || []) {
          const desc = resolveStage(stage);
          if (desc.id !== id) continue;
          name = name || desc.name;
          country = country || desc.country;
          if (
            /cup|champions|europa|conference|world|libertadores|nations/i.test(
              desc.name || ''
            )
          ) {
            isCup = true;
          }
          for (const event of stage.Events || []) {
            collected.push(shape.fixture(event, desc, stage));
          }
        }
      } catch {
        // skip a failed day
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LEAGUE_CONCURRENCY, dates.length) }, worker)
  );

  if (collected.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  const seen = new Set();
  const fixtures = collected.filter((f) => {
    if (seen.has(f.fixture.id)) return false;
    seen.add(f.fixture.id);
    return true;
  });
  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0)
  );

  return {
    league: { id, name, country, type: isCup ? 'Cup' : 'League' },
    fixtures,
    window: { past, future },
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
