require('dotenv').config();

const fetchData = require('../../utils/fetchData');
const Squad = require('../../models/players/squads');
const { apiUrl } = require('../../utils/constants');
const { persist } = require('../../utils/db');

const API_ENDPOINT = `${apiUrl}/players/squads`;

const getSquads = async (params, attempts = 0) => {
  const data = await fetchData(API_ENDPOINT, params);

  if (!data.response || data.response.length === 0) {
    if (attempts < 2) {
      // 2 here because the first call is attempt 0
      return getSquads(params, attempts + 1);
    } else {
      return { error: 'Empty data after multiple attempts' };
    }
  }

  const squadData = data.response.map((item) => ({
    team: item.team,
    players: item.players,
  }));

  const groupedData = {
    queryParams: params,
    allSquads: squadData,
    updatedAt: Date.now(), // Set the updatedAt timestamp
  };

  await persist('squads', async () => {
    const existingData = await Squad.findOne({ queryParams: params });

    if (!existingData) {
      await Squad.create(groupedData);
    } else if (
      existingData.updatedAt < new Date(new Date() - 24 * 60 * 60 * 1000)
    ) {
      await Squad.findOneAndReplace(
        { queryParams: params },
        { ...groupedData, updatedAt: Date.now() }
      );
    }
  });

  return groupedData;
};

module.exports = {
  getSquads,
};
