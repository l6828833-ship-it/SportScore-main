/**
 * Match alerts: kick-offs, goals, half-time and full-time results, pushed to
 * the Android app through Firebase Cloud Messaging.
 *
 * Called once a minute (Cloud Scheduler -> POST /notify/tick). Each check reads
 * every match in play, compares it with what the previous check saw (see
 * utils/notify/store), and sends one message per change to the topics of the
 * two teams and the competition.
 *
 * Messages carry data, not text. The app writes the notification itself, in
 * the reader's language, choosing between the English and Arabic names sent
 * here (the source's other languages would mean a feed request each, every
 * minute). The app also drops the kinds of alert the reader turned off.
 *
 * Nothing is sent when the state is missing or old — the first check after a
 * pause only notes what is going on, rather than announcing an hour of goals at
 * once.
 */
const client = require('../../utils/scores365/client');
const nz = require('../../utils/scores365/normalize');
const fixtures = require('../scores365/fixtures');
const { isSupported } = require('../../utils/scores365/leagues');
const store = require('../../utils/notify/store');
const fcm = require('../../utils/notify/fcm');

const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const DONE = new Set(['FT', 'AET', 'PEN']);

/** Older than this, the saved state no longer says what the last minute was. */
const STALE_MS = 10 * 60 * 1000;
/** A match that left the feed is forgotten after this long. */
const FORGET_MS = 3 * 60 * 60 * 1000;
/** A match first seen this far in is not announced as kicking off. */
const KICKOFF_WINDOW_MINUTES = 5;

const ENGLISH = '1';
const ARABIC = '27';

const todayKey = () => new Date().toISOString().slice(0, 10);
const yesterdayKey = () =>
  new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** Today's and yesterday's matches (UTC), so one past midnight is not lost. */
async function matches(langId) {
  const days = await Promise.all(
    [yesterdayKey(), todayKey()].map((day) =>
      // Live-fresh, so an alert is not held back by the 30-second cache.
      fixtures
        .fixturesForDate(day, 'UTC', langId, false, client.LIVE_MAX_AGE)
        .catch(() => []),
    ),
  );
  return days.flat();
}

/** What changed between two looks at one match. */
function changes(previous, current, fixture) {
  const out = [];
  const minute = fixture.fixture.status.elapsed;
  if (!previous) {
    if (
      LIVE.has(current.s) &&
      (minute == null || minute <= KICKOFF_WINDOW_MINUTES)
    ) {
      out.push({ type: 'kickoff' });
    }
    return out;
  }
  for (let n = previous.h; n < current.h; n += 1) {
    out.push({ type: 'goal', side: 'home' });
  }
  for (let n = previous.a; n < current.a; n += 1) {
    out.push({ type: 'goal', side: 'away' });
  }
  if (current.s === 'HT' && previous.s !== 'HT') out.push({ type: 'halftime' });
  if (DONE.has(current.s) && !DONE.has(previous.s))
    out.push({ type: 'fulltime' });
  return out;
}

/**
 * The scorer of the match's latest goal, in English and Arabic, for the
 * competitions this server pins (where readers mostly are). Elsewhere a goal
 * alert just gives the score: a detail request per goal worldwide is not
 * worth it.
 */
async function latestScorer(fixture) {
  if (!isSupported(fixture.league.id)) return {};
  const read = async (langId) => {
    try {
      const { game } = await client.game(fixture.fixture.id, { langId });
      const goals = nz.events(game).filter((e) => e.type === 'Goal');
      return goals[goals.length - 1] || null;
    } catch {
      return null;
    }
  };
  const [english, arabic] = await Promise.all([read(ENGLISH), read(ARABIC)]);
  return {
    scorer: (english && english.player.name) || '',
    scorerAr: (arabic && arabic.player.name) || '',
    minute:
      english && english.time.elapsed != null
        ? String(english.time.elapsed)
        : '',
  };
}

function message(fixture, arabic, change, extra) {
  const home = fixture.teams.home;
  const away = fixture.teams.away;
  const leagueId = fixture.league.id;
  const topics = [`team_${home.id}`, `team_${away.id}`, `league_${leagueId}`];
  const data = {
    type: change.type,
    matchId: String(fixture.fixture.id),
    leagueId: String(leagueId),
    homeId: String(home.id),
    awayId: String(away.id),
    home: home.name || '',
    away: away.name || '',
    homeAr: (arabic && arabic.teams.home.name) || '',
    awayAr: (arabic && arabic.teams.away.name) || '',
    league: fixture.league.name || '',
    leagueAr: (arabic && arabic.league.name) || '',
    homeGoals: String(fixture.goals.home ?? 0),
    awayGoals: String(fixture.goals.away ?? 0),
    minute: String(fixture.fixture.status.elapsed ?? ''),
    side: change.side || '',
    scorer: '',
    scorerAr: '',
    ...extra,
  };
  return {
    condition: fcm.condition(topics),
    data,
    android: {
      priority: 'HIGH',
      // A goal alert an hour late is noise; a result keeps a little longer.
      ttl: change.type === 'fulltime' ? '3600s' : '900s',
    },
  };
}

/** One check. Returns what it saw and sent, for the scheduler's log. */
async function tick() {
  if (!fcm.isConfigured()) {
    const error = new Error('FCM_PROJECT_ID is not set');
    error.status = 503;
    throw error;
  }
  const now = Date.now();
  const { state, version } = await store.load();
  const fresh = Boolean(state && now - (state.updatedAt || 0) < STALE_MS);
  const previous = (fresh && state.games) || {};

  const [english, arabicList] = await Promise.all([
    matches(ENGLISH),
    matches(ARABIC),
  ]);
  const arabic = new Map(arabicList.map((f) => [f.fixture.id, f]));

  const games = {};
  const seen = new Set();
  const pending = [];
  for (const fixture of english) {
    const id = String(fixture.fixture.id);
    const status = fixture.fixture.status.short;
    seen.add(id);
    const before = previous[id];
    if (!before && !LIVE.has(status)) continue;
    const current = {
      s: status,
      h: fixture.goals.home ?? 0,
      a: fixture.goals.away ?? 0,
      t: now,
    };
    if (fresh) {
      for (const change of changes(before, current, fixture)) {
        pending.push({ fixture, change });
      }
    }
    // A finished match has nothing more to say.
    if (!DONE.has(status)) games[id] = current;
  }
  // A match missing from one feed answer is kept a while, not dropped and then
  // announced as kicking off when it comes back.
  for (const [id, game] of Object.entries(previous)) {
    if (!seen.has(id) && !games[id] && now - game.t < FORGET_MS)
      games[id] = game;
  }

  if (!(await store.save({ updatedAt: now, games }, version))) {
    return { skipped: 'another check saved first', events: 0, sent: 0 };
  }

  let sent = 0;
  const failures = [];
  for (const { fixture, change } of pending) {
    const extra = change.type === 'goal' ? await latestScorer(fixture) : {};
    try {
      await fcm.send(
        message(fixture, arabic.get(fixture.fixture.id), change, extra),
      );
      sent += 1;
    } catch (error) {
      failures.push(
        `${change.type} ${fixture.fixture.id}: ${error.response ? error.response.status : error.message}`,
      );
    }
  }
  return {
    baseline: !fresh,
    tracked: Object.keys(games).length,
    events: pending.length,
    sent,
    failures: failures.slice(0, 5),
  };
}

/**
 * A sample alert to one topic, to check delivery end to end: `team_104` reaches
 * every phone following Arsenal.
 */
async function test({ topic, type = 'goal' } = {}) {
  if (!fcm.isConfigured()) {
    const error = new Error('FCM_PROJECT_ID is not set');
    error.status = 503;
    throw error;
  }
  if (!/^(team|league)_\d+$/.test(String(topic || ''))) {
    const error = new Error('`topic` must look like team_104 or league_39');
    error.status = 400;
    throw error;
  }
  await fcm.send({
    topic,
    data: {
      type,
      matchId: '0',
      leagueId: '39',
      homeId: '104',
      awayId: '110',
      home: 'Arsenal',
      away: 'Chelsea',
      homeAr: 'أرسنال',
      awayAr: 'تشيلسي',
      league: 'Premier League',
      leagueAr: 'الدوري الإنجليزي',
      homeGoals: '1',
      awayGoals: '0',
      minute: '23',
      side: 'home',
      scorer: 'Bukayo Saka',
      scorerAr: 'بوكايو ساكا',
      test: 'true',
    },
    android: { priority: 'HIGH', ttl: '300s' },
  });
  return { sent: 1, topic, type };
}

module.exports = { tick, test, changes };
