/**
 * Teams for the LiveScore source.
 *
 * LiveScore has no clean per-competition team roster endpoint, and the consumer
 * app no longer has team pages, so this reports the feature as unavailable
 * rather than half-implementing it. Crests still appear on fixtures and tables
 * (they come inline with those payloads).
 */

const notSupported = (what) => async () => {
  const error = new Error(
    `${what} are not available from the LiveScore source. Use SOURCE=apifootball with a key.`
  );
  error.status = 501;
  throw error;
};

module.exports = {
  getTeams: notSupported('Teams'),
  getTeamSeasons: notSupported('Team seasons'),
  getTeamStatistics: notSupported('Team statistics'),
};
