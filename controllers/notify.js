const crypto = require('crypto');
const alerts = require('../services/notify/alerts');

/**
 * The alert routes are for Cloud Scheduler and the operator, not the public:
 * they need the `X-Notify-Key` header to match NOTIFY_KEY. Without NOTIFY_KEY
 * set they do not exist at all.
 */
function authorized(req) {
  const expected = process.env.NOTIFY_KEY || '';
  const given = String(req.get('x-notify-key') || '');
  if (!expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const guarded = (run) => async (req, res) => {
  if (!process.env.NOTIFY_KEY)
    return res.status(404).json({ error: 'Not found' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(await run(req));
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    console.error('[notify]', error.message);
    res.status(status).json({ error: error.message });
  }
};

// POST /notify/tick — one check for kick-offs, goals and results.
const tick = guarded(() => alerts.tick());

// POST /notify/test?topic=team_104&type=goal — one sample alert.
const test = guarded((req) =>
  alerts.test({ topic: req.query.topic, type: req.query.type }),
);

module.exports = { tick, test };
