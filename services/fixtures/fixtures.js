require('dotenv').config();

const { apiUrl } = require('../../utils/constants');
const fetchData = require('../../utils/fetchData');
const { filterByLeague } = require('../../utils/leagueFilter');
const { persist } = require('../../utils/db');
const GroupedFixture = require('../../models/fixtures/fixtures'); // Import the schema

const API_ENDPOINT = `${apiUrl}/fixtures`;

const getFixtures = async (params, attempts = 0) => {
  const data = await fetchData(API_ENDPOINT, params);

  if (!data.response || data.response.length === 0) {
    if (attempts < 2) {
      // 2 here because the first call is attempt 0
      return getFixtures(params, attempts + 1);
    } else {
      return { error: 'Empty data after multiple attempts' };
    }
  }

  // Optional whitelist, opt-in via LEAGUE_IDS. Unrestricted by default so the
  // full API-Football catalogue (1200+ competitions) comes through.
  const filteredData = filterByLeague(data.response);

  // Process the filtered data into the schema
  const fixtureData = filteredData.map((item) => ({
    fixture: item.fixture,
    league: item.league,
    teams: item.teams,
    goals: item.goals,
    score: item.score,
  }));

  // Create a single object to group all the fixtures and include the query params
  const groupedData = {
    queryParams: params,
    allFixtures: fixtureData,
  };

  await persist('fixtures', async () => {
    const existingData = await GroupedFixture.findOne({ queryParams: params });

    if (!existingData) {
      const fixtureGroup = new GroupedFixture(groupedData);
      fixtureGroup.updatedAt = Date.now();
      await fixtureGroup.save();
    } else if (
      existingData.updatedAt < new Date(new Date() - 24 * 60 * 60 * 1000)
    ) {
      await GroupedFixture.findOneAndReplace(
        { queryParams: params },
        { ...groupedData, updatedAt: Date.now() }
      );
    }
  });

  return fixtureData;
};

const getRounds = async (params) => {
  return await fetchData(`${API_ENDPOINT}/rounds`, params);
};

/**
 * One fixture, with everything the upstream attaches to it.
 *
 * Querying `/fixtures` by `id`/`ids` makes API-Football return the enriched
 * object — `events`, `lineups`, `statistics` and `players` are included inline.
 * `getFixtures` above reshapes those away, which forced a consumer to spend
 * three more requests on /events, /statistics and /lineups to rebuild a single
 * match page. This keeps them, so a match detail costs ONE upstream request.
 *
 * Deliberately no league filter and no Mongo write-through: this is the hot
 * path for a live match, and the fixture id is already specific.
 */
const getFixtureById = async (params) => {
  const id = params.id || params.ids || params.fixture;
  if (!id) {
    return { error: 'An `id` query parameter is required' };
  }

  const data = await fetchData(API_ENDPOINT, { id });
  const fixture = Array.isArray(data.response) ? data.response[0] : null;

  if (!fixture) {
    return { error: 'Fixture not found' };
  }

  return fixture;
};

module.exports = {
  getRounds,
  getFixtures,
  getFixtureById,
};
