/**
 * Teams from ESPN. No API key.
 *
 * ESPN's team list is per competition, so a lookup by id has to find which
 * competition the team belongs to. Those lists are long-cached, so the scan is
 * paid once.
 */

const client = require('../../utils/espn/client');
const catalogue = require('../../utils/espn/leagues');
const { num } = require('../../utils/espn/normalize');

const CONCURRENCY = Number(process.env.ESPN_CONCURRENCY) || 8;

function entry(team, league) {
  return {
    team: {
      id: num(team.id),
      name: team.displayName || team.shortDisplayName || team.name || null,
      code: team.abbreviation || null,
      // ESPN carries no per-team nationality, so the competition's country is
      // used — correct for a domestic league, and deliberately null for a
      // continental one where the teams span many countries.
      country: league && league.country !== 'World' ? league.country : null,
      // Not exposed by ESPN on any endpoint.
      founded: null,
      national: false,
      logo:
        (team.logos && team.logos[0] && team.logos[0].href) ||
        team.logo ||
        null,
    },
    venue: { id: null, name: null, city: null },
  };
}

function extract(data) {
  return (
    (data.sports &&
      data.sports[0] &&
      data.sports[0].leagues &&
      data.sports[0].leagues[0] &&
      data.sports[0].leagues[0].teams) ||
    []
  );
}

const getTeams = async (params = {}) => {
  const requested = catalogue.resolveLeague(params.league);

  // By competition: one request.
  if (requested && !params.id) {
    let data;
    try {
      data = await client.teams(requested.slug);
    } catch {
      return { error: 'Empty data after multiple attempts' };
    }
    const teams = extract(data).map((e) => entry(e.team || {}, requested));
    return teams.length > 0
      ? { queryParams: params, allTeams: teams, updatedAt: Date.now() }
      : { error: 'Empty data after multiple attempts' };
  }

  // By id: locate the team across the catalogue.
  if (params.id) {
    const wanted = String(params.id);
    const leagues = requested ? [requested] : catalogue.scanLeagues();

    const hits = await client.mapLimited(
      leagues,
      CONCURRENCY,
      async (league) => {
        const data = await client.teams(league.slug);
        const found = extract(data).find(
          (e) => String(e.team && e.team.id) === wanted
        );
        return found ? entry(found.team, league) : null;
      }
    );

    const team = hits.find(Boolean);
    return team
      ? { queryParams: params, allTeams: [team], updatedAt: Date.now() }
      : { error: 'Empty data after multiple attempts' };
  }

  return {
    error:
      'Provide `league` or `id`. GET /leagues/getLeagues lists competitions.',
  };
};

/** Season-by-season team history is not exposed by ESPN. */
const getTeamSeasons = async () => ({
  error: 'Team seasons are not available from the ESPN source',
});

/** Aggregate season statistics per team are not exposed by ESPN. */
const getTeamStatistics = async () => ({
  error: 'Team season statistics are not available from the ESPN source',
});

module.exports = { getTeams, getTeamSeasons, getTeamStatistics };
