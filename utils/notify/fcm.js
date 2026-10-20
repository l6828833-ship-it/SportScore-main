/**
 * Firebase Cloud Messaging, HTTP v1: one message at a time, to a topic
 * condition.
 *
 * The app subscribes to `team_{id}` and `league_{id}` for what the reader
 * follows. A match's alert goes to "home team OR away team OR competition", so
 * a reader following both a team and its league still gets it once.
 */
const axios = require('axios');
const google = require('./google');

const projectId = () => process.env.FCM_PROJECT_ID;

const isConfigured = () => Boolean(projectId());

/** "'team_1' in topics || 'team_2' in topics || 'league_3' in topics". */
function condition(topics) {
  return topics.map((topic) => `'${topic}' in topics`).join(' || ');
}

async function send(message) {
  await axios.post(
    `https://fcm.googleapis.com/v1/projects/${projectId()}/messages:send`,
    { message },
    { headers: await google.headers(projectId()), timeout: 10000 },
  );
}

module.exports = { isConfigured, condition, send };
