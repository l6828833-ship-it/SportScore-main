/**
 * Standings from LiveScore.
 *
 * The table is embedded in the competition's league page
 * (`initialData.tables.league`), which carries rank, W/D/L, goals, points and a
 * team badge. Reshaped to API-Football's standings shape.
 *
 * A `description` (green/red zone) is not always present in this payload, so it
 * is left null when absent — the consumer simply shows no zone band for that
 * row rather than inventing one.
 */

const client = require('../../utils/livescore/client');
const { pageSlugFor, stableId } = require('../../utils/livescore/leagues');
const { badge, num } = require('../../utils/livescore/normalize');
const leagueFixtures = require('./fixtures');

/**
 * Cups whose table must come from the page preview, NOT computed from fixtures.
 *
 * A cup runs qualifying rounds before its league/group phase, and computing a
 * table from ALL fixtures merges the two — the Champions League ends up with 79
 * rows, qualifiers like Sabah above Real Madrid. LiveScore's page already shows
 * the correct league-phase table, so for these ids the preview is authoritative
 * and the fixture-computed table is not used.
 */
const CUP_IDS = new Set([1, 2, 3, 6, 848]);

/**
 * A cup round that belongs to the standings table (its league/group phase),
 * as opposed to knockout ties or qualifying, which do not have a table.
 */
function isLeaguePhaseRound(round) {
  const r = String(round || '').toLowerCase();
  return (
    r.includes('league stage') ||
    r.includes('league phase') ||
    r.includes('group') ||
    // A group stage sometimes reads "Group A - Round 3" etc.
    /group\s+[a-l]/.test(r)
  );
}

/**
 * Build a full league table from a season's fixtures.
 *
 * LiveScore's league page embeds only a SHORT preview of the table (the top few
 * rows); the full table is lazy-loaded from an endpoint that is not reliably
 * reachable. Rather than ship a truncated table, the complete standings are
 * computed from finished fixtures — points, goal difference, the standard
 * tiebreakers — which is accurate for a single-table league and always full.
 *
 * The preview from the page is still used for team crests (it carries badge
 * URLs the fixtures list may lack) and, when it already contains every team,
 * short-circuits this computation.
 */
function computeTable(fixtures, crestByName) {
  const tally = new Map();
  const ensure = (team) => {
    const key = team.name || String(team.id);
    let t = tally.get(key);
    if (!t) {
      t = {
        id: team.id,
        name: team.name,
        logo:
          team.logo ||
          (crestByName && crestByName.get(norm(team.name))) ||
          null,
        played: 0,
        win: 0,
        draw: 0,
        lose: 0,
        gf: 0,
        ga: 0,
        points: 0,
      };
      tally.set(key, t);
    }
    if (!t.logo && team.logo) t.logo = team.logo;
    return t;
  };

  // First pass: register EVERY team that appears in the phase, played or not,
  // so the table is complete from matchday one (all 36 Champions League teams
  // show at 0 points, not just the dozen who have kicked off). Only teams with
  // a real id/name are seeded, to avoid a blank placeholder row.
  for (const f of fixtures) {
    if (f.teams.home && f.teams.home.name) ensure(f.teams.home);
    if (f.teams.away && f.teams.away.name) ensure(f.teams.away);
  }

  // Second pass: tally results from finished matches only.
  for (const f of fixtures) {
    if (!['FT', 'AET', 'PEN'].includes(f.fixture.status.short)) continue;
    const hg = f.goals.home;
    const ag = f.goals.away;
    if (typeof hg !== 'number' || typeof ag !== 'number') continue;
    const home = ensure(f.teams.home);
    const away = ensure(f.teams.away);
    home.played += 1;
    away.played += 1;
    home.gf += hg;
    home.ga += ag;
    away.gf += ag;
    away.ga += hg;
    if (hg > ag) {
      home.win += 1;
      home.points += 3;
      away.lose += 1;
    } else if (hg < ag) {
      away.win += 1;
      away.points += 3;
      home.lose += 1;
    } else {
      home.draw += 1;
      away.draw += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const rows = [...tally.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.gf - b.ga - (a.gf - a.ga) ||
      b.gf - a.gf ||
      (a.name || '').localeCompare(b.name || '')
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

const norm = (v) =>
  String(v || '')
    .trim()
    .toLowerCase();

function row(team, groupName) {
  return {
    rank: num(team.rank),
    team: {
      id: num(team.id) ?? stableId(team.name),
      name: team.name || team.shortName || null,
      logo: badge(team.teamBadge),
    },
    points: num(team.points),
    goalsDiff: num(team.goalsDiff),
    group: groupName,
    form: null,
    status: null,
    // LiveScore encodes qualification via `stagePhases` colour codes rather than
    // a text label; without a reliable phrase, the zone is left unset.
    description: null,
    all: {
      played: num(team.played),
      win: num(team.wins),
      draw: num(team.draws),
      lose: num(team.losses),
      goals: { for: num(team.goalsFor), against: num(team.goalsAgainst) },
    },
    home: null,
    away: null,
    update: null,
  };
}

const getStandings = async (params = {}) => {
  const slug = pageSlugFor(params.league);
  if (!slug) {
    return {
      error: `No table available for competition "${params.league}" on LiveScore.`,
    };
  }

  let initial;
  try {
    initial = await client.leaguePage(slug.country, slug.competition);
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const groups = Object.values(
    (initial.tables && initial.tables.league) || {}
  ).flat();
  const preview = (groups[0] && groups[0].teams) || [];
  const leagueName = (groups[0] && groups[0].name) || null;

  // Crests from the preview, keyed by name, to enrich the computed table.
  const crestByName = new Map();
  for (const team of preview) {
    if (team.name && team.teamBadge) {
      crestByName.set(norm(team.name), badge(team.teamBadge));
    }
  }

  const isCup = CUP_IDS.has(Number(params.league));

  // Compute the full table from this season's fixtures — the page preview is
  // only a handful of rows.
  //
  // For a cup, only the LEAGUE/GROUP-PHASE fixtures are counted, never the
  // qualifying rounds, so the Champions League table is its real ~36-team
  // league phase and not a 79-row merge with qualifiers. A domestic league has
  // no such phases, so all its fixtures count.
  let full = [];
  try {
    const lf = await leagueFixtures.getLeagueFixtures({
      league: params.league,
      // Cover the current season either side of today. Include UPCOMING
      // fixtures too, so every team in the phase is listed from the start — a
      // Champions League table shows all 36 teams on matchday 1, not only the
      // ones that have already played. Each day is cached, so this is a one-off
      // cost warmed once per competition.
      past: Number(process.env.LIVESCORE_TABLE_PAST_DAYS) || 250,
      future: Number(process.env.LIVESCORE_TABLE_FUTURE_DAYS) || 120,
    });
    full = Array.isArray(lf.fixtures) ? lf.fixtures : [];
  } catch {
    full = [];
  }

  if (isCup) {
    full = full.filter((f) => isLeaguePhaseRound(f.league && f.league.round));
  }

  const computed = full.length > 0 ? computeTable(full, crestByName) : [];

  const rows =
    computed.length > 0 && computed.length >= preview.length
      ? computed.map((r) => ({
          rank: r.rank,
          team: { id: r.id ?? stableId(r.name), name: r.name, logo: r.logo },
          points: r.points,
          goalsDiff: r.gf - r.ga,
          group: null,
          form: null,
          status: null,
          description: null,
          all: {
            played: r.played,
            win: r.win,
            draw: r.draw,
            lose: r.lose,
            goals: { for: r.gf, against: r.ga },
          },
          home: null,
          away: null,
          update: null,
        }))
      : preview.map((team) => row(team, null));

  if (rows.length === 0) return { error: 'Empty data after multiple attempts' };

  return {
    queryParams: params,
    league: {
      id: Number(params.league),
      name: leagueName,
      country: slug.country,
      logo: null,
      flag: null,
      season: num(params.season),
    },
    standings: [rows],
    updatedAt: Date.now(),
  };
};

module.exports = { getStandings };
