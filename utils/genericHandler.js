/**
 * Wraps a service call into an HTTP response.
 *
 * Upstream failures carry their own status (401 for a missing key, 502 for an
 * API-Football `errors` payload, 503 for a network fault). Reporting all of
 * those as a flat 500 — as this used to — makes a misconfigured key
 * indistinguishable from a bug in this server.
 */
const genericHandler = async (modelFunction, req, res, errorMessage) => {
  try {
    const data = await modelFunction(req.query);
    res.json(data);
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    console.error(`[api] ${errorMessage}:`, error.message);
    res.status(status).json({ error: errorMessage, detail: error.message });
  }
};

module.exports = genericHandler;
