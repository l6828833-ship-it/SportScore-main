/**
 * League tables scraped from BBC Sport. No API, no key.
 *
 * One page load per competition. The rows carry everything a table needs plus a
 * form guide and the qualification zone label, which API-Football's free tier
 * does not always supply.
 */

const client = require('../../utils/scrape/client');
const catalogue = require('../../utils/scrape/leagues');
const shape = require('../../utils/scrape/normalize');
const crests = require('../../utils/scrape/crests');

const { collectGroups } = require('./tableRows');

const getStandings = async (params = {}) => {
  const league = catalogue.resolveLeague(params.league);
  if (!league || !league.slug) {
    return {
      error: `No table available for competition "${params.league}". GET /leagues/getLeagues lists the supported ones.`,
    };
  }

  let payload;
  try {
    payload = await client.table(league.slug);
  } catch (error) {
    if (error.status === 404) {
      return { error: 'Empty data after multiple attempts' };
    }
    throw error;
  }

  const groups = collectGroups(payload);
  if (groups.length === 0)
    return { error: 'Empty data after multiple attempts' };

  // A single table must not be labelled, or a consumer renders a pointless
  // group heading above it.
  const single = groups.length === 1;

  const standings = groups.map((group) =>
    group.rows
      .map((row) => shape.standingRow(row, single ? null : group.name))
      .sort((a, b) => (a.rank || 0) - (b.rank || 0))
  );

  // Add ESPN crests by team name (cached per competition for a month).
  await crests.preload(league.slug);
  for (const table of standings) {
    for (const row of table) {
      const url = await crests.crestFor(league.slug, row.team.name);
      if (url) row.team.logo = url;
    }
  }

  return {
    queryParams: params,
    league: {
      id: league.apiFootballId,
      name: league.name,
      country: league.country,
      logo: null,
      flag: null,
      season: shape.num(params.season),
    },
    standings,
    updatedAt: Date.now(),
  };
};

module.exports = { getStandings };
