/**
 * Optional league whitelist.
 *
 * The original code hard-filtered `/fixtures` and `/leagues` down to 17 European
 * competition ids. That silently discarded everything else — including Saudi,
 * Gulf and Iraqi football — after the upstream request had already been paid
 * for, which is the worst of both worlds.
 *
 * It is now opt-in via `LEAGUE_IDS`, and unrestricted by default:
 *
 *   LEAGUE_IDS=            -> no filtering (default)
 *   LEAGUE_IDS=39,140,307  -> only those competition ids
 *
 * The original 17 ids are kept in `LEGACY_LEAGUE_IDS` so the old behaviour is
 * one copy-paste away.
 */

/** World Cup, Ligue 1, Premier League, Bundesliga, Serie A, La Liga, Euros,
 *  Champions League, Coupe de France, DFB Pokal, FA Cup, League Cup, MLS,
 *  Europa League, Coppa Italia, Copa del Rey, Conference League. */
const LEGACY_LEAGUE_IDS = [
  4, 61, 39, 78, 135, 140, 1, 2, 66, 81, 45, 48, 253, 3, 137, 143, 848,
];

const allowedLeagueIds = (() => {
  const raw = (process.env.LEAGUE_IDS || '').trim();
  if (!raw) return null; // null = allow everything
  if (raw.toLowerCase() === 'legacy') return new Set(LEGACY_LEAGUE_IDS);
  const ids = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? new Set(ids) : null;
})();

/** Filter a list of API-Football items that each carry `league.id`. */
const filterByLeague = (items) => {
  if (!allowedLeagueIds) return items;
  return items.filter((item) => allowedLeagueIds.has(item?.league?.id));
};

module.exports = {
  allowedLeagueIds,
  filterByLeague,
  LEGACY_LEAGUE_IDS,
};
