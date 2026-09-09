/**
 * Standings from 365scores.
 *
 * The competition standings endpoint returns a full ranked table with
 * played / W / D / L / goals / points, reshaped to API-Football's structure.
 * Multi-group tables (cup phases) keep each group's label.
 */

const client = require('../../utils/scores365/client');
const nz = require('../../utils/scores365/normalize');
const { to365Id } = require('../../utils/scores365/leagues');

const getStandings = async (params = {}) => {
  const exposedId = Number(params.league);
  const compId = to365Id(exposedId);
  if (!compId) {
    return {
      error: `No table available for competition "${params.league}" on 365scores.`,
    };
  }

  let body;
  try {
    body = await client.standings(compId, {
      timezoneName: params.timezoneName,
    });
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const groups = Array.isArray(body.standings) ? body.standings : [];
  if (groups.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  // A single-group league table carries no meaningful group label; a
  // multi-group cup does, and each group's rows must stay tagged so the table
  // does not collapse "position 1" several times into one ranking.
  const multi = groups.length > 1;
  const allRows = [];
  let leagueName = null;
  for (const group of groups) {
    const groupName = multi ? group.displayName || group.name || null : null;
    leagueName = leagueName || group.displayName || null;
    for (const row of group.rows || []) {
      allRows.push(nz.standingRow(row, groupName));
    }
  }

  if (allRows.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  return {
    queryParams: params,
    league: {
      id: exposedId,
      name: leagueName,
      country: null,
      logo: nz.competitionLogo(compId),
      flag: null,
      season: nz.num(params.season),
    },
    standings: [allRows],
    updatedAt: Date.now(),
  };
};

module.exports = { getStandings };
