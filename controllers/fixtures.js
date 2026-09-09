const source = require('../utils/source');

// Every implementation exposes the same functions and returns the same shapes,
// so the swap is invisible to the routes below and to any consumer.
const fixturesModel = source.pick({
  apifootball: require('../services/fixtures/fixtures'),
  espn: require('../services/espn/fixtures'),
  scrape: require('../services/scrape/fixtures'),
  livescore: require('../services/livescore/fixtures'),
  '365scores': require('../services/scores365/fixtures'),
});
const headToHeadModel = require('../services/fixtures/headtohead');
const statisticsModel = require('../services/fixtures/statistics');
const eventsModel = require('../services/fixtures/events');
const lineupsModel = require('../services/fixtures/lineups');
const playersModel = require('../services/fixtures/players');

const GroupedFixture = require('../models/fixtures/fixtures');
const HeadToHeadModel = require('../models/fixtures/headtohead');
const StatisticsModel = require('../models/fixtures/statistics');
const EventsModel = require('../models/fixtures/events');
const LineupsModel = require('../models/fixtures/lineups');
const PlayersModel = require('../models/fixtures/players');

const genericHandler = require('../utils/genericHandler');
const retrieveDataFromDb = require('../utils/retrieveData');

/**
 * `getLeagueFixtures` (a competition's recent+upcoming matches) exists on the
 * scrape source. For a source without it, fall back to filtering the per-date
 * fixtures by league so the route still answers rather than throwing.
 */
const leagueFixtures =
  fixturesModel.getLeagueFixtures ||
  (async (params) => {
    const fixtures = await fixturesModel.getFixtures({ league: params.league });
    return Array.isArray(fixtures)
      ? { league: null, fixtures, window: null }
      : fixtures;
  });

const endpoints = {
  fixtures: fixturesModel.getFixtures,
  fixtureById: fixturesModel.getFixtureById,
  leagueFixtures,
  rounds: fixturesModel.getRounds,
  headtohead: headToHeadModel.getHeadToHeadFixtures,
  statistics: statisticsModel.getFixtureStatistics,
  events: eventsModel.getFixtureEvents,
  lineups: lineupsModel.getFixtureLineups,
  players: playersModel.getFixturePlayers,
};

// http://localhost:3000/fixtures/getFixtures?date=2023-10-05
const getFixtures = (req, res) =>
  genericHandler(endpoints.fixtures, req, res, 'Failed to fetch fixtures');

// http://localhost:3000/fixtures/getLeagueFixtures?league=39
// A competition's recent results + upcoming matches (for the league page).
const getLeagueFixtures = (req, res) =>
  genericHandler(
    endpoints.leagueFixtures,
    req,
    res,
    'Failed to fetch league fixtures'
  );

// http://localhost:3000/fixtures/getFixtureById?id=215662
// Returns the enriched fixture: events, lineups, statistics and players inline.
const getFixtureById = (req, res) =>
  genericHandler(endpoints.fixtureById, req, res, 'Failed to fetch fixture');

// http://localhost:3000/fixtures/getRounds?league=39&season=2024
const getRounds = (req, res) =>
  genericHandler(endpoints.rounds, req, res, 'Failed to fetch rounds');

// http://localhost:3000/fixtures/getFixtureHeadToHead?h2h=33-39
const getTeamHeadToHead = (req, res) =>
  genericHandler(
    endpoints.headtohead,
    req,
    res,
    'Failed to fetch head to head'
  );

// http://localhost:3000/fixtures/getMatchStatistics?fixture=394
const getTeamStatistics = (req, res) =>
  genericHandler(endpoints.statistics, req, res, 'Failed to fetch statistics');

// http://localhost:3000/fixtures/getMatchEvents?fixture=394
const getTeamEvents = (req, res) =>
  genericHandler(endpoints.events, req, res, 'Failed to fetch events');

// http://localhost:3000/fixtures/getMatchLineups?fixture=394
const getTeamLineups = (req, res) =>
  genericHandler(endpoints.lineups, req, res, 'Failed to fetch lineups');

// http://localhost:3000/fixtures/getMatchPlayerStatistics?fixture=394
const getTeamPlayersStatistics = (req, res) =>
  genericHandler(
    endpoints.players,
    req,
    res,
    'Failed to fetch player statistics'
  );

// http://localhost:3000/fixtures/db/getFixtures?league=39&season=2022
const getFixturesFromDb = (req, res) =>
  retrieveDataFromDb(
    GroupedFixture,
    fixturesModel.getFixtures, // pass the fetch function here
    req.query,
    res,
    'No fixtures found for the provided parameters'
  );

// http://localhost:3000/fixtures/db/getStatistics?fixture=394
const getHeadToHeadFromDb = (req, res) =>
  retrieveDataFromDb(
    HeadToHeadModel,
    headToHeadModel.getHeadToHeadFixtures,
    req.query,
    res,
    'No head-to-head data found for the provided parameters'
  );

const getStatisticsFromDb = (req, res) =>
  retrieveDataFromDb(
    StatisticsModel,
    statisticsModel.getFixtureStatistics,
    req.query,
    res,
    'No statistics data found for the provided parameters'
  );

const getEventsFromDb = (req, res) =>
  retrieveDataFromDb(
    EventsModel,
    eventsModel.getFixtureEvents,
    req.query,
    res,
    'No events data found for the provided parameters'
  );

const getLineupsFromDb = (req, res) =>
  retrieveDataFromDb(
    LineupsModel,
    lineupsModel.getFixtureLineups,
    req.query,
    res,
    'No lineups data found for the provided parameters'
  );

const getPlayersFromDb = (req, res) =>
  retrieveDataFromDb(
    PlayersModel,
    playersModel.getFixturePlayers,
    req.query,
    res,
    'No players data found for the provided parameters'
  );

module.exports = {
  getFixtures,
  getFixtureById,
  getLeagueFixtures,
  getRounds,
  getTeamHeadToHead,
  getTeamStatistics,
  getTeamEvents,
  getTeamLineups,
  getTeamPlayersStatistics,
  getFixturesFromDb,
  getHeadToHeadFromDb,
  getStatisticsFromDb,
  getEventsFromDb,
  getLineupsFromDb,
  getPlayersFromDb,
};
