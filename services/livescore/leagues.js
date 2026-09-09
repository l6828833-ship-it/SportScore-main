/**
 * Competition list for the LiveScore source.
 *
 * LiveScore has 200+ competitions on any given day, so a static "all leagues"
 * list is neither useful nor accurate. This returns the competitions that are
 * playing today (from the date feed), de-duplicated — which is what a browse
 * page actually wants — in the API-Football-shaped envelope.
 */

const client = require('../../utils/livescore/client');
const { resolveStage } = require('../../utils/livescore/leagues');

const todayKey = () => new Date().toISOString().slice(0, 10);

const getLeagues = async () => {
  let feed;
  try {
    feed = await client.dateFeed(todayKey(), true);
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const seen = new Map();
  for (const stage of feed.Stages || []) {
    const desc = resolveStage(stage);
    if (seen.has(desc.id)) continue;
    const isCup =
      /cup|champions|europa|conference|world|libertadores|nations/i.test(
        desc.name || ''
      );
    seen.set(desc.id, {
      league: {
        id: desc.id,
        name: desc.name,
        type: isCup ? 'Cup' : 'League',
        logo: stage.badgeUrl || null,
      },
      country: { name: desc.country, code: stage.Ccd || null, flag: null },
      seasons: [],
    });
  }

  return [...seen.values()];
};

module.exports = { getLeagues };
