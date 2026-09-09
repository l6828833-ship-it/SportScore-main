require('dotenv').config();

const { apiUrl } = require('../utils/constants');
const fetchData = require('../utils/fetchData');
const { filterByLeague } = require('../utils/leagueFilter');
const { persist } = require('../utils/db');
const League = require('../models/leagues'); // Import the schema

const API_ENDPOINT = `${apiUrl}/leagues`;

const getLeagues = async (params, attempts = 0) => {
  const data = await fetchData(API_ENDPOINT, params);

  if (!data.response || data.response.length === 0) {
    if (attempts < 2) {
      // 2 here because the first call is attempt 0
      return getLeagues(params, attempts + 1);
    } else {
      return { error: 'Empty data after multiple attempts' };
    }
  }

  // Process the data into the schema
  const leagueData = data.response.map((item) => ({
    league: item.league,
    country: item.country,
    seasons: item.seasons,
  }));

  // Optional whitelist, opt-in via LEAGUE_IDS (unrestricted by default).
  const filteredLeagueData = filterByLeague(leagueData);

  // Create a single object to group all the leagues
  const groupedData = {
    allLeagues: filteredLeagueData,
    updatedAt: Date.now(), // Set the updatedAt timestamp
  };

  await persist('leagues', async () => {
    const selector = {
      'allLeagues.league.id': {
        $in: groupedData.allLeagues.map((l) => l.league.id),
      },
    };
    const existingData = await League.findOne(selector);

    if (!existingData) {
      await new League(groupedData).save();
    } else if (
      existingData.updatedAt < new Date(new Date() - 24 * 60 * 60 * 1000)
    ) {
      await League.findOneAndReplace(selector, {
        ...groupedData,
        updatedAt: Date.now(),
      });
    }
  });

  return filteredLeagueData;
};

module.exports = {
  getLeagues,
};
