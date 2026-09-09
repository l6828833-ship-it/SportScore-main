const source = require('../utils/source');

const espnPlayers = require('../services/espn/players');
const scrapePlayers = require('../services/scrape/players');
const livescorePlayers = require('../services/livescore/players');
const scores365Players = require('../services/scores365/players');

const forSource = (apifootball) =>
  source.pick({
    apifootball,
    espn: espnPlayers,
    scrape: scrapePlayers,
    livescore: livescorePlayers,
    '365scores': scores365Players,
  });

const playersModel = forSource(require('../services/players/players'));
const squadsModel = forSource(require('../services/players/squads'));
const scorersModel = forSource(require('../services/players/scorers'));
const assistsModel = forSource(require('../services/players/assists'));
const seasonsModel = forSource(require('../services/players/seasons'));
const profilesModel = forSource(require('../services/players/profiles'));

const Assist = require('../models/players/assists');
const Scorer = require('../models/players/scorers');
const Squad = require('../models/players/squads');
const Player = require('../models/players/players');
const Seasons = require('../models/players/seasons');

const retrieveDataFromDb = require('../utils/retrieveData');
const genericHandler = require('../utils/genericHandler');

const endpoints = {
  players: playersModel.getPlayers,
  squads: squadsModel.getSquads,
  scorers: scorersModel.getTopScorers,
  assists: assistsModel.getAssists,
  seasons: seasonsModel.getPlayerSeasons,
  profiles: profilesModel.searchProfiles,
};

// http://localhost:3000/players/searchPlayers?search=salah
// Name search across the whole player database (no league/season needed).
const searchPlayers = (req, res) =>
  genericHandler(endpoints.profiles, req, res, 'Failed to search players');

// http://localhost:3000/players/getPlayers?team=39&season=2022
const getPlayers = (req, res) =>
  genericHandler(endpoints.players, req, res, 'Failed to fetch players');

const getSeasons = (req, res) =>
  genericHandler(endpoints.seasons, req, res, 'Failed to fetch player seasons');

// http://localhost:3000/players/getSquads?team=39
const getSquads = (req, res) =>
  genericHandler(endpoints.squads, req, res, 'Failed to fetch squads');

// http://localhost:3000/players/getTopScorers?league=39&season=2022
const getTopScorers = (req, res) =>
  genericHandler(endpoints.scorers, req, res, 'Failed to fetch top scorers');

// http://localhost:3000/players/getTopAssists?league=39&season=2022
const getTopAssists = (req, res) =>
  genericHandler(endpoints.assists, req, res, 'Failed to fetch assists');

// http://localhost:3000/players/db/getPlayers?team=39&season=2022
const getPlayersFromDb = (req, res) => {
  retrieveDataFromDb(
    Player,
    playersModel.getPlayers,
    req.query,
    res,
    'No players found for the provided parameters'
  );
};

// http://localhost:3000/players/db/getSquads?team=39
const getSquadsFromDb = (req, res) => {
  retrieveDataFromDb(
    Squad,
    squadsModel.getSquads,
    req.query,
    res,
    'No squads found for the provided parameters'
  );
};

// http://localhost:3000/players/db/getTopScorers?league=39&season=2022
const getTopScorersFromDb = (req, res) => {
  retrieveDataFromDb(
    Scorer,
    scorersModel.getTopScorers,
    req.query,
    res,
    'No top scorers found for the provided parameters'
  );
};

// http://localhost:3000/players/db/getTopAssists?league=39&season=2022
const getTopAssistsFromDb = (req, res) => {
  retrieveDataFromDb(
    Assist,
    assistsModel.getAssists,
    req.query,
    res,
    'No assists found for the provided parameters'
  );
};

// http://localhost:3000/players/db/getSeasons?player=907
const getSeasonsFromDb = (req, res) => {
  retrieveDataFromDb(
    Seasons,
    seasonsModel.getPlayerSeasons,
    req.query,
    res,
    'No seasons found for the provided parameters'
  );
};

module.exports = {
  getPlayers,
  searchPlayers,
  getSquads,
  getTopScorers,
  getTopAssists,
  getSeasons,
  getPlayersFromDb,
  getSquadsFromDb,
  getTopScorersFromDb,
  getTopAssistsFromDb,
  getSeasonsFromDb,
};
