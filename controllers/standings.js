const source = require('../utils/source');

const standingsModel = source.pick({
  apifootball: require('../services/standings'),
  espn: require('../services/espn/standings'),
  scrape: require('../services/scrape/standings'),
  livescore: require('../services/livescore/standings'),
  '365scores': require('../services/scores365/standings'),
});
const Standing = require('../models/standings'); // Import the schema

const retrieveDataFromDb = require('../utils/retrieveData');
const genericHandler = require('../utils/genericHandler');

const endpoints = {
  standings: standingsModel.getStandings,
};

// http://localhost:3000/standings/getStandings?league=39&season=2021
const getStandings = (req, res) =>
  genericHandler(endpoints.standings, req, res, 'Failed to fetch standings');

// http://localhost:3000/standings/db/getStandings?league=39&season=2021
const getStandingsFromDb = (req, res) => {
  retrieveDataFromDb(
    Standing,
    standingsModel.getStandings,
    req.query,
    res,
    'No standings found for the provided parameters'
  );
};

module.exports = {
  getStandings,
  getStandingsFromDb,
};
