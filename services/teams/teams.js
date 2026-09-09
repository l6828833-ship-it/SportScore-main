require('dotenv').config();

const { apiUrl } = require('../../utils/constants');
const fetchData = require('../../utils/fetchData');
const { persist } = require('../../utils/db');
const GroupedTeam = require('../../models/teams/teams'); // Import the modified schema

const API_ENDPOINT = `${apiUrl}/teams`;

const getTeams = async (params, attempts = 0) => {
  const data = await fetchData(API_ENDPOINT, params);

  if (!data.response || data.response.length === 0) {
    if (attempts < 2) {
      // 2 here because the first call is attempt 0
      return getTeams(params, attempts + 1);
    } else {
      return { error: 'Empty data after multiple attempts' };
    }
  }

  // Process the data into the schema
  const teamData = data.response.map((item) => ({
    team: item.team,
    venue: item.venue,
  }));

  // Create a single object to group all the teams and include the query params
  const groupedData = {
    queryParams: params,
    allTeams: teamData,
    updatedAt: Date.now(), // Set the updatedAt timestamp
  };

  await persist('teams', async () => {
    const existingData = await GroupedTeam.findOne({ queryParams: params });

    if (!existingData) {
      await new GroupedTeam(groupedData).save();
    } else if (
      existingData.updatedAt < new Date(new Date() - 24 * 60 * 60 * 1000)
    ) {
      await GroupedTeam.findOneAndReplace(
        { queryParams: params },
        { ...groupedData, updatedAt: Date.now() }
      );
    }
  });

  return groupedData; // Return the grouped data
};

module.exports = {
  getTeams,
};
