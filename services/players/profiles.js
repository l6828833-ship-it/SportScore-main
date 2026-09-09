require('dotenv').config();

const fetchData = require('../../utils/fetchData');
const { apiUrl } = require('../../utils/constants');

const API_ENDPOINT = `${apiUrl}/players/profiles`;

/**
 * Player name search.
 *
 * `/players` cannot do this: its `search` parameter must be paired with a
 * `league` or `team` AND a `season`, so it can only search within a squad you
 * already know. `/players/profiles` searches the whole player database by name
 * with nothing else required — which is what a search box actually needs.
 *
 * Upstream requires at least 4 characters and returns 250 per page.
 */
const searchProfiles = async (params) => {
  const search = (params.search || params.name || params.q || '').trim();

  if (search.length < 4) {
    // Answered locally: upstream rejects anything shorter, and spending a
    // request to be told so would be wasteful on a 100/day tier.
    return {
      queryParams: { search },
      players: [],
      error: search
        ? 'Search requires at least 4 characters'
        : 'A `search` query parameter is required',
    };
  }

  const data = await fetchData(API_ENDPOINT, {
    search,
    ...(params.page ? { page: params.page } : {}),
  });

  const players = (data.response || []).map((item) => item.player || item);

  return {
    queryParams: { search },
    players,
    paging: data.paging || null,
    updatedAt: Date.now(),
  };
};

module.exports = { searchProfiles };
