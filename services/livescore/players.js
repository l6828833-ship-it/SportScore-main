/**
 * Players from LiveScore.
 *
 * Top scorers are a REAL leaderboard here: the competition's league page embeds
 * `initialData.playersGoalsStats`, ranked, with team names and badges. That is
 * far better than computing from events, so no scan is needed.
 *
 * Player name search is not exposed by LiveScore's public data, so it stays
 * unavailable (501), same honest treatment as the scrape source.
 */

const client = require('../../utils/livescore/client');
const { pageSlugFor, stableId } = require('../../utils/livescore/leagues');
const { badge, num } = require('../../utils/livescore/normalize');

const getTopScorers = async (params = {}) => {
  const slug = pageSlugFor(params.league);
  if (!slug) {
    return {
      error: `No scorer data for competition "${params.league}" on LiveScore.`,
    };
  }

  let initial;
  try {
    initial = await client.leaguePage(slug.country, slug.competition);
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const players =
    (initial.playersGoalsStats && initial.playersGoalsStats.players) || [];
  if (players.length === 0)
    return { error: 'Empty data after multiple attempts' };

  return {
    queryParams: params,
    computed: false,
    topScorers: players.slice(0, 25).map((p) => ({
      player: {
        id: num(p.id) ?? stableId(p.name),
        name: p.name || null,
        nationality: null,
        // LiveScore serves a player headshot slug on some entries.
        photo: p.badge ? badge(p.badge) : null,
      },
      statistics: [
        {
          team: {
            id: stableId(p.teamName || ''),
            name: p.teamName || null,
            logo: p.teamBadgeSlug ? badge(p.teamBadgeSlug) : null,
          },
          games: { appearences: null },
          goals: {
            total: num(p.stats && p.stats.g),
            assists: num(p.stats && p.stats.a),
          },
          penalty: { scored: null },
        },
      ],
    })),
    updatedAt: Date.now(),
  };
};

const notSupported = (what) => async () => {
  const error = new Error(
    `${what} are not available from the LiveScore source. Use SOURCE=apifootball with a key.`
  );
  error.status = 501;
  throw error;
};

module.exports = {
  getTopScorers,
  searchProfiles: notSupported('Player searches'),
  getPlayers: notSupported('Player searches'),
  getAssists: notSupported('Top assists'),
  getSquads: notSupported('Squads'),
  getPlayerSeasons: notSupported('Player seasons'),
};
