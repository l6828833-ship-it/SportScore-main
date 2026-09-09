const axios = require('axios');
const cache = require('./cache');
const { authHeaders, hasApiKey, apiProvider } = require('./constants');

/**
 * Cache lifetimes.
 *
 * Empty responses get their OWN short TTL, and this matters for two reasons:
 *
 *  1. Every service retries up to 3 times on an empty `response`. Without an
 *     empty being cached, one genuinely quiet fixture date costs 3 upstream
 *     requests instead of 1 — on a 100/day free tier that is not affordable.
 *  2. Caching an empty for the full hour (the original behaviour) made the
 *     emptiness sticky: a momentary upstream blip locked a date to "no data"
 *     for 60 minutes with no way to clear it short of a restart.
 *
 * A short TTL satisfies both: the retries are absorbed by the cache, and the
 * next request a minute later gets a real answer.
 */
const TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 3600;
const TTL_EMPTY_SECONDS = Number(process.env.CACHE_TTL_EMPTY_SECONDS) || 60;
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;

/** Last quota figures reported by the upstream, exposed via GET /quota. */
const quota = {
  provider: apiProvider,
  dailyLimit: null,
  dailyRemaining: null,
  minuteLimit: null,
  minuteRemaining: null,
  updatedAt: null,
};

function recordQuota(headers) {
  if (!headers) return;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  // Both gateways use the same header names: `*-requests-*` is the daily
  // allowance, the bare pair is the per-minute rate.
  const dailyLimit = num(headers['x-ratelimit-requests-limit']);
  const dailyRemaining = num(headers['x-ratelimit-requests-remaining']);
  const minuteLimit = num(headers['x-ratelimit-limit']);
  const minuteRemaining = num(headers['x-ratelimit-remaining']);

  if (dailyLimit !== null) quota.dailyLimit = dailyLimit;
  if (dailyRemaining !== null) quota.dailyRemaining = dailyRemaining;
  if (minuteLimit !== null) quota.minuteLimit = minuteLimit;
  if (minuteRemaining !== null) quota.minuteRemaining = minuteRemaining;
  quota.updatedAt = new Date().toISOString();
}

/**
 * API-Football reports problems in a 200 response body, not in the status code.
 * `errors` is `[]` when all is well and an object like
 * `{ token: "invalid api key" }` or `{ requests: "daily limit reached" }`
 * otherwise.
 *
 * Left unread — as it was originally — a dead key, an exhausted quota and a
 * plan restriction all present identically to "this date has no fixtures".
 * That is the single most confusing failure mode of this API, so it is
 * escalated to a real thrown error here.
 */
function upstreamError(data) {
  const errors = data && data.errors;
  if (!errors) return null;
  if (Array.isArray(errors))
    return errors.length > 0 ? errors.join('; ') : null;
  if (typeof errors === 'object') {
    const entries = Object.entries(errors).filter(([, v]) => v);
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => `${k}: ${v}`).join('; ');
  }
  return typeof errors === 'string' && errors ? errors : null;
}

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status || 502;
  }
}

const fetchData = async (endpoint, params) => {
  const cacheKey = `${endpoint}-${JSON.stringify(params)}`;

  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return { ...cachedData, fromCache: true };
  }

  if (!hasApiKey()) {
    throw new UpstreamError(
      'No API-Football key configured. Set `key` in .env (see .env.example).',
      401
    );
  }

  let response;
  try {
    response = await axios.get(endpoint, {
      headers: authHeaders(),
      params,
      timeout: TIMEOUT_MS,
    });
  } catch (error) {
    const detail = error.response
      ? JSON.stringify(error.response.data)
      : error.message;
    console.error(`[upstream] ${endpoint} failed:`, detail);
    throw new UpstreamError(
      `Upstream request failed: ${error.message}`,
      error.response ? error.response.status : 503
    );
  }

  recordQuota(response.headers);

  const data = response.data;
  const problem = upstreamError(data);
  if (problem) {
    // Never cached: the fix is usually a config change, and a cached auth
    // failure would outlive the fix.
    console.error(`[upstream] ${endpoint} returned errors:`, problem);
    throw new UpstreamError(`Upstream API error — ${problem}`, 502);
  }

  const isEmpty =
    !data || !Array.isArray(data.response)
      ? !data || !data.response
      : data.response.length === 0;

  cache.set(cacheKey, data, isEmpty ? TTL_EMPTY_SECONDS : TTL_SECONDS);

  return data;
};

module.exports = fetchData;
module.exports.quota = quota;
module.exports.UpstreamError = UpstreamError;
