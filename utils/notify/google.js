/**
 * Google API access for the match alerts: an OAuth token, and the headers to
 * send it with.
 *
 * On Cloud Run the token comes from the metadata server, for the service's own
 * account, so no key file exists anywhere. For a local test run, set
 * GOOGLE_OAUTH_ACCESS_TOKEN (`gcloud auth print-access-token`); user
 * credentials then also need the project to bill, which is what the
 * `x-goog-user-project` header says.
 */
const axios = require('axios');

const METADATA_TOKEN =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

let cached = null;

async function accessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }
  // A minute of margin, so a token never expires between here and its use.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const { data } = await axios.get(METADATA_TOKEN, {
    headers: { 'Metadata-Flavor': 'Google' },
    params: { scopes: 'https://www.googleapis.com/auth/cloud-platform' },
    timeout: 5000,
  });
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 0) * 1000,
  };
  return cached.token;
}

async function headers(projectId) {
  const out = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
  };
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN)
    out['x-goog-user-project'] = projectId;
  return out;
}

module.exports = { headers };
