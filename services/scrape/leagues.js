/**
 * Competition list for the scrape source.
 *
 * Answered from the local catalogue: it is the definitive statement of which
 * competitions have a scrapable table, so it is both instant and cannot fail.
 * Note that fixtures cover far more competitions than this — BBC lists every
 * qualifying round and regional cup for a date — but only these have tables.
 */

const catalogue = require('../../utils/scrape/leagues');

const getLeagues = async (params = {}) => {
  const requested = catalogue.resolveLeague(params.id || params.league);
  const list = requested ? [requested] : catalogue.LEAGUES;

  return list.map((league) => ({
    league: {
      id: league.apiFootballId,
      name: league.name,
      type: /cup|champions|conference league|europa/i.test(league.name)
        ? 'Cup'
        : 'League',
      logo: null,
      // Not part of API-Football's shape, but useful for tracing which page an
      // id came from.
      bbcSlug: league.slug,
    },
    country: { name: league.country, code: null, flag: null },
    seasons: [],
  }));
};

module.exports = { getLeagues };
