/**
 * Competition list for the ESPN source.
 *
 * Served from the local catalogue rather than an ESPN request: ESPN has no
 * "list all soccer competitions" endpoint, and the catalogue is the definitive
 * statement of what this source actually supports. Answering locally also means
 * the list is instant and cannot fail.
 */

const catalogue = require('../../utils/espn/leagues');

const CURRENT_SEASON = (() => {
  const raw = Number(process.env.DEFAULT_SEASON);
  if (Number.isFinite(raw) && raw > 2000) return Math.round(raw);
  const now = new Date();
  return now.getUTCMonth() + 1 >= 7
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
})();

const getLeagues = async (params = {}) => {
  const requested = catalogue.resolveLeague(params.id || params.league);
  const list = requested ? [requested] : catalogue.LEAGUES;

  return list.map((league) => ({
    league: {
      id: league.apiFootballId,
      name: league.name,
      type: /cup|champions|libertadores|world|friendl|nations/i.test(
        league.name
      )
        ? 'Cup'
        : 'League',
      logo: null,
      // Not part of API-Football's shape, but harmless and useful for debugging
      // which ESPN competition an id came from.
      espnSlug: league.slug,
    },
    country: { name: league.country, code: null, flag: null },
    seasons: [{ year: CURRENT_SEASON, current: true }],
  }));
};

module.exports = { getLeagues };
