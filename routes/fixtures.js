const express = require('express');
const router = express.Router();
const fixturesController = require('../controllers/fixtures');

// Existing routes
router.get('/getFixtures', fixturesController.getFixtures);
// Single fixture WITH events, lineups, statistics and players in one request.
router.get('/getFixtureById', fixturesController.getFixtureById);
// A competition's recent + upcoming matches (drives the league page).
router.get('/getLeagueFixtures', fixturesController.getLeagueFixtures);
router.get('/getRounds', fixturesController.getRounds);
router.get('/getFixtureHeadToHead', fixturesController.getTeamHeadToHead);
router.get('/getMatchStatistics', fixturesController.getTeamStatistics);
router.get('/getMatchEvents', fixturesController.getTeamEvents);
router.get('/getMatchLineups', fixturesController.getTeamLineups);
router.get(
  '/getMatchPlayerStatistics',
  fixturesController.getTeamPlayersStatistics
);

// New routes for fetching data from the database
router.get('/db/getFixtures', fixturesController.getFixturesFromDb);
router.get('/db/getHeadToHead', fixturesController.getHeadToHeadFromDb);
router.get('/db/getStatistics', fixturesController.getStatisticsFromDb);
router.get('/db/getEvents', fixturesController.getEventsFromDb);
router.get('/db/getLineups', fixturesController.getLineupsFromDb);
router.get('/db/getPlayers', fixturesController.getPlayersFromDb);

module.exports = router;
