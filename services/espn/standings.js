/**
 * Standings from ESPN. No API key.
 *
 * ESPN nests one table per `children` entry, which maps cleanly onto
 * API-Football's array-of-tables. Group names are preserved, so a competition
 * split into groups stays split instead of collapsing into one ranking where
 * position 1 appears several times.
 */

const client = require('../../utils/espn/client');
const catalogue = require('../../utils/espn/leagues');
const { num } = require('../../utils/espn/normalize');

/** ESPN reports stats as a flat list keyed by `type`. */
function statValue(entry, type) {
  const stat = (entry.stats || []).find(
    (s) => String(s.type || '').toLowerCase() === type
  );
  if (!stat) return null;
  const raw = stat.value !== undefined ? stat.value : stat.displayValue;
  return num(raw);
}

function row(entry, groupName, rank) {
  const team = entry.team || {};
  return {
    rank: statValue(entry, 'rank') || rank,
    team: {
      id: num(team.id),
      name: team.displayName || team.shortDisplayName || team.name || null,
      logo:
        (team.logos && team.logos[0] && team.logos[0].href) ||
        team.logo ||
        null,
    },
    points: statValue(entry, 'points'),
    goalsDiff: statValue(entry, 'pointdifferential'),
    group: groupName,
    // ESPN exposes recent form as a stat on some competitions only.
    form: null,
    status: null,
    description: entry.note ? entry.note.description || null : null,
    all: {
      played: statValue(entry, 'gamesplayed'),
      win: statValue(entry, 'wins'),
      // "ties" is ESPN's name for draws.
      draw: statValue(entry, 'ties'),
      lose: statValue(entry, 'losses'),
      goals: {
        for: statValue(entry, 'pointsfor'),
        against: statValue(entry, 'pointsagainst'),
      },
    },
    home: null,
    away: null,
    update: null,
  };
}

/** Collect every `standings.entries` list, however deeply ESPN nests them. */
function collectGroups(node, out = []) {
  if (!node) return out;

  if (node.standings && Array.isArray(node.standings.entries)) {
    out.push({
      name: node.name || node.abbreviation || null,
      entries: node.standings.entries,
    });
  }
  for (const child of node.children || []) collectGroups(child, out);
  return out;
}

const getStandings = async (params = {}) => {
  const league = catalogue.resolveLeague(params.league);
  if (!league) {
    return {
      error: `Unknown competition "${params.league}". GET /leagues/getLeagues lists the supported ones.`,
    };
  }

  let data;
  try {
    data = await client.standings(league.slug, params.season);
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const groups = collectGroups(data);
  if (groups.length === 0)
    return { error: 'Empty data after multiple attempts' };

  // A single unnamed table must not be labelled, or the consumer will render a
  // pointless group heading above it.
  const single = groups.length === 1;

  const standings = groups.map((group) =>
    group.entries
      .map((entry, index) => row(entry, single ? null : group.name, index + 1))
      .sort((a, b) => (a.rank || 0) - (b.rank || 0))
  );

  return {
    queryParams: params,
    league: {
      id: league.apiFootballId,
      name: league.name,
      country: league.country,
      logo: null,
      flag: null,
      season:
        num(data.season && (data.season.year || data.season)) ||
        num(params.season),
    },
    standings,
    updatedAt: Date.now(),
  };
};

module.exports = { getStandings };
