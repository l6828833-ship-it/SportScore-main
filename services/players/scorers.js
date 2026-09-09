require('dotenv').config();

const fetchData = require('../../utils/fetchData');
const Scorer = require('../../models/players/scorers');
const { apiUrl } = require('../../utils/constants');
const { persist } = require('../../utils/db');

const API_ENDPOINT = `${apiUrl}/players/topscorers`;

const getTopScorers = async (params, attempts = 0) => {
  const data = await fetchData(API_ENDPOINT, params);

  if (!data.response || data.response.length === 0) {
    if (attempts < 2) {
      // 2 here because the first call is attempt 0
      return getTopScorers(params, attempts + 1);
    } else {
      return { error: 'Empty data after multiple attempts' };
    }
  }

  const scorerData = data.response.map((item) => ({
    player: item.player,
    statistics: item.statistics,
  }));

  const groupedData = {
    queryParams: params,
    topScorers: scorerData,
    updatedAt: Date.now(), // Set the updatedAt timestamp
  };

  await persist('topscorers', async () => {
    const existingData = await Scorer.findOne({ queryParams: params });

    if (!existingData) {
      await Scorer.create(groupedData);
    } else if (
      existingData.updatedAt < new Date(new Date() - 24 * 60 * 60 * 1000)
    ) {
      await Scorer.findOneAndReplace(
        { queryParams: params },
        { ...groupedData, updatedAt: Date.now() }
      );
    }
  });

  return groupedData;
};

module.exports = {
  getTopScorers,
};
