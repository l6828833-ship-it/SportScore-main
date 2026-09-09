/**
 * Teams for the scrape source, derived from league tables.
 *
 * BBC has no team-list page, but a competition's table names every team in it
 * with a stable URN — which is exactly the roster. The table is already cached
 * for standings, so this usually costs no extra page load.
 */

const client = require('../../utils/scrape/client');
const catalogue = require('../../utils/scrape/leagues');
const { stableId } = require('../../utils/scrape/leagues');
const { collectRows } = require('./tableRows');

function entry(row, league) {
  const name = row.name || row.shortName || null;
  return {
    team: {
      id: stableId(row.urn || name),
      name,
      code: null,
      // A domestic league's country applies to its teams; a continental one
      // spans many, so it is left null rather than guessed.
      country: league.country !== 'World' ? league.country : null,
      founded: null,
      national: false,
      // BBC's embedded data has no crest URLs; the UI falls back to initials.
      logo: null,
    },
    venue: { id: null, name: null, city: null },
  };
}

async function rowsFor(league) {
  const payload = await client.table(league.slug);
  return collectRows(payload);
}

const getTeams = async (params = {}) => {
  const requested = catalogue.resolveLeague(params.league);

  if (requested && requested.slug && !params.id) {
    let rows;
    try {
      rows = await rowsFor(requested);
    } catch {
      return { error: 'Empty data after multiple attempts' };
    }
    const teams = rows.map((row) => entry(row, requested));
    return teams.length > 0
      ? { queryParams: params, allTeams: teams, updatedAt: Date.now() }
      : { error: 'Empty data after multiple attempts' };
  }

  if (params.id) {
    const wanted = String(params.id);
    // Serialised on purpose: this walks other people's pages, so it should not
    // fan out. The tables are long-cached, so it is paid once.
    const leagues = requested ? [requested] : catalogue.LEAGUES;

    for (const league of leagues) {
      if (!league.slug) continue;
      let rows;
      try {
        rows = await rowsFor(league);
      } catch {
        continue;
      }
      const hit = rows.find(
        (row) => String(stableId(row.urn || row.name)) === wanted
      );
      if (hit) {
        return {
          queryParams: params,
          allTeams: [entry(hit, league)],
          updatedAt: Date.now(),
        };
      }
    }
    return { error: 'Empty data after multiple attempts' };
  }

  return {
    error:
      'Provide `league` or `id`. GET /leagues/getLeagues lists competitions.',
  };
};

const getTeamSeasons = async () => ({
  error: 'Team seasons are not available from the scrape source',
});

const getTeamStatistics = async () => ({
  error: 'Team season statistics are not available from the scrape source',
});

module.exports = { getTeams, getTeamSeasons, getTeamStatistics };
