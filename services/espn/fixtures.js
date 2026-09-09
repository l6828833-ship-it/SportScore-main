/**
 * Fixtures from ESPN's public endpoints. No API key.
 *
 * Structural difference from API-Football worth knowing: ESPN's scoreboard is
 * per competition, not per date, so "everything on this date" is one request per
 * competition. That is affordable only because ESPN needs no key and enforces no
 * quota — the cost is latency, not budget, and results are cached.
 */

const client = require('../../utils/espn/client');
const catalogue = require('../../utils/espn/leagues');
const shape = require('../../utils/espn/normalize');

const CONCURRENCY = Number(process.env.ESPN_CONCURRENCY) || 8;

/** Today in UTC as YYYY-MM-DD. */
const todayKey = () => new Date().toISOString().slice(0, 10);

const shiftDate = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Anchored at noon so a DST shift cannot roll the date over.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
};

/**
 * eventId -> {slug, dateKey}, filled in as scoreboards are read.
 *
 * A match detail request arrives with only a fixture id, but ESPN needs the
 * competition slug too. This remembers where each fixture was seen so the common
 * case (the user opened the match from a list) costs no extra lookup. A cold
 * start falls back to reading the slug out of the summary response.
 */
const locationIndex = new Map();
const LOCATION_INDEX_MAX = 5000;

function remember(eventId, slug, dateKey) {
  if (locationIndex.size > LOCATION_INDEX_MAX) locationIndex.clear();
  locationIndex.set(String(eventId), { slug, dateKey });
}

/** Read one competition's scoreboard for a date and reshape every fixture. */
async function fixturesForLeague(league, dateKey) {
  const board = await client.scoreboard(league.slug, dateKey);
  const espnLeague = (board.leagues && board.leagues[0]) || null;

  return (board.events || []).map((event) => {
    remember(event.id, league.slug, dateKey);
    return shape.fixture(event, league, espnLeague);
  });
}

/**
 * Mirrors API-Football's `/fixtures`. Supported filters: `date`, `live`, `team`,
 * `league`, `id`/`ids`. Anything else is ignored rather than silently returning
 * the wrong thing.
 */
const getFixtures = async (params = {}) => {
  if (params.id || params.ids) {
    const one = await getFixtureById({ id: params.id || params.ids });
    return one && !one.error ? [one] : { error: 'Fixture not found' };
  }

  if (params.team) {
    return getTeamFixtures(params);
  }

  const live = String(params.live || '').toLowerCase();
  const requested = catalogue.resolveLeague(params.league);
  const leagues = requested ? [requested] : catalogue.scanLeagues();

  /**
   * ESPN has no all-competition live feed, so the live view reuses the
   * scoreboards — but it must read YESTERDAY as well as today. A match kicking
   * off at 22:00 UTC is still in play after midnight UTC while belonging to the
   * previous day's board, so scanning only today reports "nothing live" for
   * several hours every night and freezes the match clock for a consumer that
   * overlays this feed.
   */
  const dates = live
    ? [shiftDate(todayKey(), -1), todayKey()]
    : [String(params.date || todayKey())];

  const batches = await client.mapLimited(
    leagues.flatMap((league) => dates.map((dateKey) => ({ league, dateKey }))),
    CONCURRENCY,
    ({ league, dateKey }) => fixturesForLeague(league, dateKey)
  );

  let fixtures = batches.filter(Boolean).flat();

  if (live) {
    const inPlay = new Set(['1H', '2H', 'HT', 'ET', 'PEN', 'SUSP']);
    fixtures = fixtures.filter((f) => inPlay.has(f.fixture.status.short));
    // Yesterday and today can both list a fixture around the boundary.
    const seen = new Set();
    fixtures = fixtures.filter((f) => {
      const id = f.fixture.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0)
  );

  // Same sentinel the API-Football services use for a legitimately empty result,
  // so consumers need only one convention.
  return fixtures.length > 0
    ? fixtures
    : { error: 'Empty data after multiple attempts' };
};

/** A team's season schedule — one request, unlike the per-competition scan. */
async function getTeamFixtures(params) {
  const teamId = params.team;
  const requested = catalogue.resolveLeague(params.league);

  // Without a competition hint, find the team by scanning the catalogue's team
  // lists, which are long-cached and therefore cheap after the first call.
  const league = requested || (await findLeagueForTeam(teamId));
  if (!league) return { error: 'Empty data after multiple attempts' };

  let schedule;
  try {
    schedule = await client.teamSchedule(league.slug, teamId);
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const espnLeague =
    (schedule.season && { season: schedule.season }) ||
    (schedule.leagues && schedule.leagues[0]) ||
    null;

  const fixtures = (schedule.events || []).map((event) => {
    remember(event.id, league.slug, null);
    // The schedule endpoint nests competitors one level differently but is
    // otherwise the same event shape.
    return shape.fixture(event, league, espnLeague);
  });

  return fixtures.length > 0
    ? fixtures
    : { error: 'Empty data after multiple attempts' };
}

/** Which catalogued competition contains this team. */
async function findLeagueForTeam(teamId) {
  const wanted = String(teamId);
  const leagues = catalogue.scanLeagues();

  const found = await client.mapLimited(
    leagues,
    CONCURRENCY,
    async (league) => {
      const data = await client.teams(league.slug);
      const entries =
        (data.sports &&
          data.sports[0].leagues &&
          data.sports[0].leagues[0].teams) ||
        [];
      return entries.some((e) => String(e.team && e.team.id) === wanted)
        ? league
        : null;
    }
  );

  return found.find(Boolean) || null;
}

/**
 * One fixture with events and statistics.
 *
 * Two requests, both free: the summary supplies statistics, period scores,
 * referee and attendance, while the scoreboard supplies goal-scorer NAMES —
 * the summary's copy of the event list has `athletesInvolved` emptied, so it
 * cannot be used for that.
 */
const getFixtureById = async (params = {}) => {
  const id = params.id || params.ids || params.fixture;
  if (!id) return { error: 'An `id` query parameter is required' };

  const known = locationIndex.get(String(id));
  const candidateSlugs = known
    ? [known.slug]
    : catalogue.scanLeagues().map((l) => l.slug);

  let summary = null;
  let slug = null;

  // With a remembered slug this is a single attempt. Cold, it probes the
  // catalogue until ESPN acknowledges the id.
  for (const candidate of candidateSlugs) {
    try {
      const data = await client.summary(candidate, id);
      if (data && data.header && data.header.id) {
        summary = data;
        slug = (data.header.league && data.header.league.slug) || candidate;
        break;
      }
    } catch {
      // Wrong competition for this id; keep probing.
    }
  }

  if (!summary) return { error: 'Fixture not found' };

  const league = catalogue.BY_SLUG.get(slug);
  if (!league) return { error: 'Fixture not found' };

  const header = summary.header;
  const competition = (header.competitions && header.competitions[0]) || {};
  const dateKey = competition.date
    ? String(competition.date).slice(0, 10)
    : known && known.dateKey;
  remember(id, slug, dateKey);

  // Rebuild the base fixture from the scoreboard for that date, because that is
  // the only feed carrying scorer names.
  let base = null;
  let details = [];
  if (dateKey) {
    try {
      const board = await client.scoreboard(slug, dateKey);
      const espnLeague = (board.leagues && board.leagues[0]) || null;
      const event = (board.events || []).find(
        (e) => String(e.id) === String(id)
      );
      if (event) {
        base = shape.fixture(event, league, espnLeague);
        details = (event.competitions && event.competitions[0].details) || [];
      }
    } catch {
      // Fall through to building from the summary alone.
    }
  }

  if (!base) {
    base = shape.fixture(
      {
        id: header.id,
        date: competition.date,
        status: competition.status,
        competitions: [competition],
      },
      league,
      { season: header.season }
    );
    details = competition.details || [];
  }

  // The summary is authoritative for these three: the scoreboard often omits
  // officials and attendance entirely.
  const info = summary.gameInfo || {};
  if (info.officials && info.officials.length > 0) {
    base.fixture.referee =
      info.officials[0].displayName ||
      info.officials[0].fullName ||
      base.fixture.referee;
  }
  const attendance = shape.num(info.attendance);
  if (attendance) base.fixture.attendance = attendance;

  // Period scores for a real half-time score.
  const headerHome = (competition.competitors || []).find(
    (c) => c.homeAway === 'home'
  );
  const headerAway = (competition.competitors || []).find(
    (c) => c.homeAway === 'away'
  );
  const htHome = shape.halftimeFrom(headerHome);
  const htAway = shape.halftimeFrom(headerAway);
  if (htHome !== null || htAway !== null) {
    base.score.halftime = { home: htHome, away: htAway };
  }

  return {
    ...base,
    events: shape.events(details, base.teams.home.id),
    statistics: shape.statistics(summary.boxscore && summary.boxscore.teams),
    lineups: [],
  };
};

/** Rounds are not exposed as a standalone ESPN endpoint. */
const getRounds = async () => ({
  error: 'Rounds are not available from the ESPN source',
});

module.exports = { getFixtures, getFixtureById, getRounds };
