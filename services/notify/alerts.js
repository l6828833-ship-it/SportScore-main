/**
 * Match alerts: kick-offs, goals, cards, half-time and full-time results,
 * pushed to the Android app through Firebase Cloud Messaging.
 *
 * Cloud Scheduler calls POST /notify/tick once a minute (its finest
 * schedule), and each call runs a check every [CHECK_EVERY_MS] for the
 * length of the call (see `run`), so an alert waits about 10 s rather than up
 * to a minute for the next look. Each check reads
 * every match in play, compares it with what the previous check saw (see
 * utils/notify/store), and sends one message per change to the topics of the
 * two teams, the competition and the match itself (a reader can follow one
 * match on its own).
 *
 * Red cards are counted from the match list, for every competition. Yellow
 * cards are only in a match's own detail, so they are read for the
 * competitions this server pins (`isSupported`) — where the readers are —
 * rather than for every match in the world every minute.
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
/** Match details read at once, for the yellow cards. */
const DETAIL_CONCURRENCY = 8;
/** How often a call checks, and for how long it keeps checking. */
const CHECK_EVERY_MS = 10 * 1000;
/** Under the scheduler's 50 s attempt deadline, with room for the last check. */
const RUN_FOR_MS = 41 * 1000;
/** A match detail this old is read again, for the yellow cards. */
const DETAIL_MAX_AGE = 15;

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
  for (let n = previous.rh ?? current.rh; n < current.rh; n += 1) {
    out.push({ type: 'red', side: 'home' });
  }
  for (let n = previous.ra ?? current.ra; n < current.ra; n += 1) {
    out.push({ type: 'red', side: 'away' });
  }
  // Only between two checks that both read the detail: the first one that does
  // is a baseline, not a match's worth of bookings at once.
  if (previous.yh != null && current.yh != null) {
    for (let n = previous.yh; n < current.yh; n += 1) {
      out.push({ type: 'yellow', side: 'home' });
    }
  }
  if (previous.ya != null && current.ya != null) {
    for (let n = previous.ya; n < current.ya; n += 1) {
      out.push({ type: 'yellow', side: 'away' });
    }
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

/**
 * The match's events, from its detail, in English (or null if it could not be
 * read). The detail is cached briefly, so a match page open in the app and
 * this check share one request.
 */
async function detailEvents(fixture, langId = ENGLISH) {
  try {
    const { game } = await client.game(fixture.fixture.id, {
      langId,
      maxAge: DETAIL_MAX_AGE,
    });
    return game ? nz.events(game) : null;
  } catch {
    return null;
  }
}

const isYellow = (e) =>
  e.type === 'Card' && /^yellow card$/i.test(e.detail || '');
const isRed = (e) => e.type === 'Card' && !isYellow(e);

/** Yellow cards per side, from a match's events. */
function yellowCounts(fixture, events) {
  const homeId = fixture.teams.home.id;
  const yellows = events.filter(isYellow);
  const home = yellows.filter((e) => e.team.id === homeId).length;
  return { yh: home, ya: yellows.length - home };
}

/** The player shown the match's latest card of this colour on this side. */
async function latestCard(fixture, type, side) {
  if (!isSupported(fixture.league.id)) return {};
  const homeId = fixture.teams.home.id;
  const pick = (events) => {
    const cards = (events || []).filter(
      (e) =>
        (type === 'yellow' ? isYellow(e) : isRed(e)) &&
        (e.team.id === homeId) === (side === 'home'),
    );
    return cards[cards.length - 1] || null;
  };
  const [english, arabic] = await Promise.all([
    detailEvents(fixture, ENGLISH).then(pick),
    detailEvents(fixture, ARABIC).then(pick),
  ]);
  return {
    scorer: (english && english.player.name) || '',
    scorerAr: (arabic && arabic.player.name) || '',
    minute:
      english && english.time.elapsed != null
        ? String(english.time.elapsed)
        : '',
  };
}

/** Runs [work] over [items], [limit] at a time. */
async function inBatches(items, limit, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await work(items[index]);
      }
    }),
  );
  return out;
}

function message(fixture, arabic, change, extra) {
  const home = fixture.teams.home;
  const away = fixture.teams.away;
  const leagueId = fixture.league.id;
  const topics = [
    `team_${home.id}`,
    `team_${away.id}`,
    `league_${leagueId}`,
    `match_${fixture.fixture.id}`,
  ];
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
      // An alert an hour late is noise; a result keeps a little longer.
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

  const english = await matches(ENGLISH);
  // Yellow cards for the matches in play in the pinned competitions.
  const tracked = english.filter(
    (f) => LIVE.has(f.fixture.status.short) && isSupported(f.league.id),
  );
  const yellows = new Map();
  await inBatches(tracked, DETAIL_CONCURRENCY, async (fixture) => {
    const events = await detailEvents(fixture);
    if (events) yellows.set(fixture.fixture.id, yellowCounts(fixture, events));
  });

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
      rh: fixture.teams.home.redCards ?? 0,
      ra: fixture.teams.away.redCards ?? 0,
      ...(yellows.get(fixture.fixture.id) || {}),
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

  // Nothing new and saved recently: no write. Checks every 10 s would
  // otherwise write the state 6 times a minute for nothing.
  const unchanged =
    fresh &&
    pending.length === 0 &&
    now - (state.updatedAt || 0) < SAVE_AT_LEAST_EVERY_MS &&
    JSON.stringify(strip(games)) === JSON.stringify(strip(previous));
  if (unchanged) {
    return {
      baseline: false,
      tracked: Object.keys(games).length,
      events: 0,
      sent: 0,
      failures: [],
    };
  }
  if (!(await store.save({ updatedAt: now, games }, version))) {
    return { skipped: 'another check saved first', events: 0, sent: 0 };
  }

  // Arabic names only when there is something to send.
  const arabic = new Map(
    pending.length ? (await matches(ARABIC)).map((f) => [f.fixture.id, f]) : [],
  );
  let sent = 0;
  const failures = [];
  for (const { fixture, change } of pending) {
    const extra =
      change.type === 'goal'
        ? await latestScorer(fixture)
        : change.type === 'yellow' || change.type === 'red'
          ? await latestCard(fixture, change.type, change.side)
          : {};
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

/** A state without its timestamps, to tell whether anything changed. */
const SAVE_AT_LEAST_EVERY_MS = 60 * 1000;
function strip(games) {
  const out = {};
  for (const id of Object.keys(games).sort()) {
    const { t, ...rest } = games[id];
    out[id] = rest;
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks every CHECK_EVERY_MS for RUN_FOR_MS: what one scheduler call does.
 * Two overlapping calls cannot double-send — the state is saved with a
 * precondition, so the second check of a pair finds it moved and skips.
 */
async function run() {
  const started = Date.now();
  const results = [];
  for (;;) {
    const checkStarted = Date.now();
    try {
      results.push(await tick());
    } catch (error) {
      if (error.status === 503) throw error; // not configured: say so
      results.push({ error: error.message });
    }
    // Nothing in play: one check a minute is enough, and the call ends
    // instead of holding the server for 40 s.
    const last = results[results.length - 1];
    if (last && last.tracked === 0) break;
    const next = checkStarted + CHECK_EVERY_MS;
    if (next - started > RUN_FOR_MS) break;
    await sleep(Math.max(0, next - Date.now()));
  }
  return {
    checks: results.length,
    sent: results.reduce((n, r) => n + (r.sent || 0), 0),
    events: results.reduce((n, r) => n + (r.events || 0), 0),
    last: results[results.length - 1],
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
  if (!/^(team|league|match)_\d+$/.test(String(topic || ''))) {
    const error = new Error(
      '`topic` must look like team_104, league_39 or match_4870753',
    );
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

module.exports = { tick, run, test, changes };
