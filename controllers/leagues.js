const source = require('../utils/source');

const leaguesModel = source.pick({
  apifootball: require('../services/leagues'),
  espn: require('../services/espn/leagues'),
  scrape: require('../services/scrape/leagues'),
  livescore: require('../services/livescore/leagues'),
  '365scores': require('../services/scores365/leagues'),
});
const League = require('../models/leagues'); // Import the schema

const genericHandler = require('../utils/genericHandler');
const retrieveDataFromDb = require('../utils/retrieveData');

const endpoints = {
  leagues: leaguesModel.getLeagues,
};

// http://localhost:3000/leagues/getLeagues
const getLeagues = (req, res) =>
  genericHandler(endpoints.leagues, req, res, 'Failed to fetch leagues');

// http://localhost:3000/leagues/db/getLeagues
const getLeaguesFromDb = (req, res) => {
  retrieveDataFromDb(
    League,
    leaguesModel.getLeagues,
    req.query, // We're passing the query parameters, even if it's empty now. It's good for future extensions.
    res,
    'No leagues found for the provided parameters'
  );
};

module.exports = {
  getLeagues,
  getLeaguesFromDb,
};
