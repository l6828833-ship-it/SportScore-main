/**
 * Players from 365scores.
 *
 * The competition stats endpoint returns FULL, ranked leaderboards — a real
 * top-20 for goals AND assists, not a 3-row preview — with player name, team,
 * position and (for goals) penalties. Reshaped to API-Football's top-scorers
 * shape, with assist counts merged in from the assists leaderboard so the app's
 * assists column is populated.
 *
 * Player name search is not exposed here, so it stays unavailable (501), the
 * same honest treatment as the other scrape sources.
 */

const client = require('../../utils/scores365/client');
const nz = require('../../utils/scores365/normalize');
const { to365Id } = require('../../utils/scores365/leagues');

/**
 * Competitions whose `/stats` leaderboard MERGES qualifying-round goals with the
 * real competition, so the top-scorers list shows qualifier players (Veljko
 * Simic, Mario Kvesic...) instead of the league-phase scorers (Haaland, Mbappé).
 * For these the leaderboard is COMPUTED from the league-phase fixtures' goal
 * events instead — the same reason their standings are computed, not taken from
 * the raw table. Keyed by the exposed (API-Football) id.
 */
const COMPUTE_FROM_FIXTURES = new Set([
  2, //   UEFA Champions League
  3, //   UEFA Europa League
  848, // UEFA Conference League
  1, //   FIFA World Cup
  6, //   Africa Cup of Nations
]);

const CONCURRENCY = Number(process.env.SCORES365_SCORER_CONCURRENCY) || 5;
const SCORER_LIMIT = Number(process.env.SCORES365_SCORER_LIMIT) || 25;

/**
 * Stat type ids, the language-independent way to find a leaderboard.
 *
 * `athletesStats[].name` is LOCALIZED — with the default Arabic `langId` (27)
 * the goals board is called "الأهداف", not "Goals" — so selecting a category by
 * its English name found nothing and every domestic league reported an empty
 * leaderboard. Each category declares its `statsTypes[].typeId`, which is
 * stable across languages:
 *
 *   1 goals   2 assists   10 goals from penalties   3 yellow   4 red
 *
 * The FIRST entry in `statsTypes` is the category's own metric (the rest are
 * the secondary columns), so a category is identified by `statsTypes[0].typeId`.
 */
const STAT_TYPE_GOALS = 1;
const STAT_TYPE_ASSISTS = 2;
const STAT_TYPE_PENALTY_GOALS = 10;

/** The typeId a category ranks on, i.e. its primary metric. */
function categoryTypeId(category) {
  const types = category.statsTypes || [];
  return types.length ? nz.num(types[0].typeId) : null;
}

/**
 * Pull one athlete-stat category from the stats payload.
 *
 * Matched on `typeId`, with the localized name kept only as a fallback for a
 * payload that omits `statsTypes`.
 */
function categoryRows(body, typeId, name) {
  const cats = (body.stats && body.stats.athletesStats) || [];
  const cat =
    cats.find((c) => categoryTypeId(c) === typeId) ||
    cats.find((c) => String(c.name || '').toLowerCase() === name.toLowerCase());
  return (cat && cat.rows) || [];
}

/**
 * The value a row is ranked on.
 *
 * Read by `typeId` when one is given, because a row carries several stats
 * (goals AND penalties on the goals board) and their order is not guaranteed.
 * Falls back to the first numeric value.
 */
function primaryValue(row, typeId) {
  const stats = row.stats || [];
  if (!stats.length) return null;
  if (typeId != null) {
    const hit = stats.find((s) => Number(s.typeId) === typeId);
    if (hit) return nz.num(hit.value);
  }
  return nz.num(stats[0].value);
}

/**
 * Penalties from a Goals row: typeId 10, or parsed from `secondaryStatName`.
 *
 * The label is localized ("ضربات الجزاء المسجلة: 0" in Arabic), so the text
 * fallback accepts a bare trailing number rather than requiring the English
 * wording. It only ever runs when typeId 10 is absent.
 */
function penalties(row) {
  const pen = (row.stats || []).find(
    (s) => Number(s.typeId) === STAT_TYPE_PENALTY_GOALS
  );
  if (pen) return nz.num(pen.value);
  const m = /:\s*(\d+)\s*$/.exec(row.secondaryStatName || '');
  return m ? Number(m[1]) : null;
}

/**
 * Leaderboard from the `/stats` endpoint (domestic leagues).
 *
 * A single-table league has no qualifying rounds, so its stats leaderboard is
 * the real thing: a full top-20 for goals with assists merged in.
 */
async function scorersFromStats(compId, params) {
  let body;
  try {
    body = await client.stats(compId, { timezoneName: params.timezoneName });
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const goals = categoryRows(body, STAT_TYPE_GOALS, 'Goals');
  if (goals.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  const assistRows = categoryRows(body, STAT_TYPE_ASSISTS, 'Assists');
  const assistById = new Map();
  for (const r of assistRows) {
    const e = r.entity || {};
    if (e.id != null) {
      assistById.set(e.id, primaryValue(r, STAT_TYPE_ASSISTS));
    }
  }

  const topScorers = goals.map((row) => {
    const e = row.entity || {};
    return {
      player: {
        id: nz.num(e.id),
        name: e.name || null,
        nationality: null,
        photo: nz.athleteImage(e.id),
      },
      statistics: [
        {
          team: {
            id: nz.num(e.competitorId),
            name: null,
            logo: nz.competitorLogo(e.competitorId),
          },
          games: { appearences: null },
          goals: {
            total: primaryValue(row, STAT_TYPE_GOALS),
            assists: assistById.has(e.id) ? assistById.get(e.id) : null,
          },
          penalty: { scored: penalties(row) },
        },
      ],
    };
  });

  return {
    queryParams: params,
    computed: false,
    topScorers,
    updatedAt: Date.now(),
  };
}

/**
 * Leaderboard COMPUTED from a cup's league-phase fixtures.
 *
 * The `/stats` leaderboard for a cup merges qualifying goals, so instead each
 * finished league-phase game's events are tallied — goals per scorer, assists
 * per assister, penalties from the goal subtype. This is the only way to show
 * the real Champions League scorers (Haaland, Mbappé) rather than the qualifier
 * players the raw stats return.
 */
async function scorersFromFixtures(compId, params) {
  const opts = { timezoneName: params.timezoneName };
  // Every game read below is already finished, so its detail is cached for a
  // day rather than the 30s live TTL. Without this the whole season's games are
  // re-fetched every half minute and the fan-out grows past the caller's
  // timeout as the league phase fills up.
  const gameOpts = { ...opts, finished: true };
  const [resultsRes, fixturesRes] = await Promise.all([
    client.competitionResults(compId, opts).catch(() => ({ games: [] })),
    client.competitionFixtures(compId, opts).catch(() => ({ games: [] })),
  ]);
  const finished = [
    ...(resultsRes.games || []),
    ...(fixturesRes.games || []),
  ].filter((g) => g.statusGroup === 4);

  if (finished.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  // player id -> tally. A single failed game detail is skipped, not fatal.
  const tally = new Map();
  const ensure = (id, name, teamId) => {
    let t = tally.get(id);
    if (!t) {
      t = {
        id,
        name: name || null,
        teamId: teamId || null,
        goals: 0,
        assists: 0,
        penalties: 0,
      };
      tally.set(id, t);
    }
    if (!t.name && name) t.name = name;
    if (!t.teamId && teamId) t.teamId = teamId;
    return t;
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < finished.length) {
      const g = finished[cursor++];
      let detail;
      try {
        detail = (await client.game(g.id, gameOpts)).game;
      } catch {
        continue; // upstream hiccup on one game must not drop the board
      }
      for (const ev of nz.events(detail)) {
        if (!ev.player.id) continue;
        const scorer = ensure(ev.player.id, ev.player.name, ev.team.id);
        if (ev.detail === 'Own Goal') {
          // An own goal counts for neither the scorer's tally nor a top-scorer.
          continue;
        }
        scorer.goals += 1;
        if (ev.detail === 'Penalty') scorer.penalties += 1;
        if (ev.assist.id)
          ensure(ev.assist.id, ev.assist.name, null).assists += 1;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, finished.length) }, worker)
  );

  const ranked = [...tally.values()]
    .filter((t) => t.goals > 0)
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        b.assists - a.assists ||
        (a.name || '').localeCompare(b.name || '')
    )
    .slice(0, SCORER_LIMIT);

  if (ranked.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  const topScorers = ranked.map((t) => ({
    player: {
      id: t.id,
      name: t.name,
      nationality: null,
      photo: nz.athleteImage(t.id),
    },
    statistics: [
      {
        team: {
          id: t.teamId,
          name: null,
          logo: nz.competitorLogo(t.teamId),
        },
        games: { appearences: null },
        goals: { total: t.goals, assists: t.assists || null },
        penalty: { scored: t.penalties || null },
      },
    ],
  }));

  return {
    queryParams: params,
    computed: true,
    topScorers,
    updatedAt: Date.now(),
  };
}

const getTopScorers = async (params = {}) => {
  const exposedId = Number(params.league);
  const compId = to365Id(exposedId);
  if (!compId) {
    return {
      error: `No scorer data for competition "${params.league}" on 365scores.`,
    };
  }

  return COMPUTE_FROM_FIXTURES.has(exposedId)
    ? scorersFromFixtures(compId, params)
    : scorersFromStats(compId, params);
};

const notSupported = (what) => async () => {
  const error = new Error(
    `${what} are not available from the 365scores source. Use SOURCE=apifootball with a key.`
  );
  error.status = 501;
  throw error;
};

module.exports = {
  getTopScorers,
  searchProfiles: notSupported('Player searches'),
  getPlayers: notSupported('Player searches'),
  getAssists: notSupported('Top assists'),
  getSquads: notSupported('Squads'),
  getPlayerSeasons: notSupported('Player seasons'),
};
