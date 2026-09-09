/**
 * Optional MongoDB persistence.
 *
 * Mongo is a cache that survives restarts, not a requirement. Without it the
 * server still works — it just falls back to the in-process node-cache.
 *
 * The subtlety: Mongoose BUFFERS model operations when no connection exists and
 * only rejects after `bufferTimeoutMS` (10s by default). Since every service
 * wraps its persistence in try/catch, that turned a missing `DB` into a silent
 * ~10 second penalty on every single request. `bufferCommands: false` makes
 * those calls reject immediately instead.
 */

const mongoose = require('mongoose');

let configured = false;

function initDb() {
  const uri = process.env.DB;

  if (!uri) {
    // Fail fast rather than buffering for 10s per request.
    mongoose.set('bufferCommands', false);
    console.warn(
      '[db] DB is not set — running without persistence (in-memory cache only).'
    );
    return;
  }

  configured = true;
  mongoose.set('bufferTimeoutMS', 5000);
  mongoose
    .connect(uri)
    .then(() => console.log('[db] connected'))
    .catch((err) =>
      // Non-fatal on purpose: the football routes do not need Mongo to answer.
      console.error(
        '[db] connection failed, continuing without it:',
        err.message
      )
    );
}

/** True only when a connection is configured AND currently open. */
function dbReady() {
  return configured && mongoose.connection.readyState === 1;
}

/**
 * Run a persistence block. No-op when there is no database, and never lets a
 * storage failure break the HTTP response — the upstream data is already in
 * hand by the time this runs.
 */
async function persist(label, fn) {
  if (!dbReady()) return;
  try {
    await fn();
  } catch (error) {
    console.error(`[db] ${label} write failed:`, error.message);
  }
}

module.exports = { initDb, dbReady, persist };
