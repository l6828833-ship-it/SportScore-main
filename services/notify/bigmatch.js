/**
 * Tournament-day reminders: "Champions League today — the big match: Real
 * Madrid v Manchester City", about an hour before that match. One tournament
 * and ONE match per reminder, never a list. Only tournaments and cups (World
 * Cup, Champions League, continental and domestic cup finals...), never a
 * regular league matchday.
 *
 * Sent ONLY to readers who have not opened the app for 48 hours or more: the
 * point is to bring back someone who forgot the app, not to add noise for
 * someone using it every day. That works through dated topics. Every time the
 * app opens it subscribes to `away_{audience}_{day}`, where `day` is three days
 * ahead (days since 1970-01-01, UTC), and leaves the one it had. A reminder on
 * day D goes to every such topic for days D-AWAY_WINDOW_DAYS..D, so it reaches
 * installs whose last open was at least 48 hours ago and none that opened
 * since. Installs away longer than the window stop getting reminders.
 *
 * Rarely: per audience at most one a day and WEEKLY_CAP in seven days; only
 * the World Cup and Champions League finals go past the weekly cap.
 *
 * Two audiences:
 *  - `arab` (readers in the Arab world or reading Arabic) get the world's big
 *    tournaments AND the Arab ones (AFCON, the African and Asian Champions
 *    Leagues, Arab cup finals), with Arab teams preferred as the highlight.
 *  - `world` gets the world's big tournaments only, and never a highlight
 *    involving an Arab club or national team: on a World Cup day with Morocco
 *    playing, the world audience hears about another match, or nothing.
 *
 * Team and competition ids are the feed's own (365scores), which are stable.
 */

/** Europe's (and the world's) biggest clubs. */
const BIG_CLUBS = new Set([
  131, // Real Madrid
  132, // Barcelona
  134, // Atletico Madrid
  110, // Manchester City
  108, // Liverpool
  104, // Arsenal
  106, // Chelsea
  105, // Manchester United
  114, // Tottenham
  331, // Bayern Munich
  341, // Borussia Dortmund
  480, // PSG
  226, // Juventus
  224, // Inter
  227, // AC Milan
  234, // Napoli
]);

/** The Arab world's biggest clubs. */
const ARAB_CLUBS = new Set([
  5457, // Al Hilal
  7549, // Al Nassr
  8593, // Al Ittihad
  8946, // Al Ahli Jeddah
  8945, // Al Shabab
  8200, // Al Ahly
  8201, // Zamalek
  22143, // Pyramids
  8326, // Wydad
  8204, // Raja
  8235, // Esperance
  8239, // Club Africain
  8241, // Etoile du Sahel
  8218, // MC Alger
  8225, // CR Belouizdad
  6992, // Al Sadd
  8353, // Al Ain
]);

const BIG_NATIONS = new Set([
  2378, // Argentina
  2379, // Brazil
  5061, // France
  5050, // Spain
  5054, // England
  5028, // Portugal
  2372, // Germany
]);

/** Every Arab national team, so none is ever the world audience's highlight. */
const ARAB_NATIONS = new Set([
  5093, // Morocco
  5087, // Saudi Arabia
  5100, // Egypt
  5109, // Algeria
  5104, // Tunisia
  5079, // Qatar
  5083, // Jordan
  5078, // Iraq
  5089, // UAE
  5081, // Oman
  5080, // Bahrain
  5092, // Kuwait
  5090, // Syria
  5088, // Lebanon
  18361, // Palestine
  5908, // Libya
  5099, // Sudan
  5599, // Mauritania
  7497, // Yemen
  8445, // Comoros
  5596, // Djibouti
  27810, // Somalia
]);

/** Matches that are big whatever the stage. */
const DERBIES = [
  [131, 132], // El Clásico
  [131, 134], // Madrid derby
  [110, 105], // Manchester derby
  [108, 107], // Merseyside derby
  [104, 114], // North London derby
  [224, 227], // Derby della Madonnina
  [225, 236], // Derby della Capitale
  [331, 341], // Der Klassiker
  [480, 469], // Le Classique
  [135, 146], // Seville derby
  [945, 946], // Galatasaray v Fenerbahçe
  [887, 888], // O Clássico
  [754, 753], // Old Firm
  [5457, 7549], // Riyadh derby
  [8593, 8946], // Jeddah derby
  [8200, 8201], // Cairo derby
  [8326, 8204], // Casablanca derby
  [8235, 8239], // Tunis derby
].map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`));
const DERBY = new Set(DERBIES);

/**
 * The tournaments a reminder can be about, and how big a day of each is
 * before its matches are looked at. `arab: true` means the Arab audience only.
 * `knockoutOnly` tournaments count from the stage given (5 = semi-finals,
 * 7 = final), so an early cup round never qualifies.
 */
const TOURNAMENTS = new Map([
  [1, { base: 50 }], // World Cup
  [2, { base: 40 }], // Champions League
  [3, { base: 10, from: 5 }], // Europa League
  [848, { base: 0, from: 7 }], // Conference League
  [13, { base: 0, from: 7 }], // Libertadores
  [45, { base: 0, from: 5 }], // FA Cup
  [48, { base: 0, from: 7 }], // Carabao Cup
  [143, { base: 0, from: 5 }], // Copa del Rey
  [137, { base: 0, from: 7 }], // Coppa Italia
  [81, { base: 0, from: 7 }], // DFB-Pokal
  [66, { base: 0, from: 7 }], // Coupe de France
  [6, { base: 30, arab: true }], // Africa Cup of Nations
  [12, { base: 20, arab: true }], // CAF Champions League
  [17, { base: 20, arab: true }], // AFC Champions League
  [839857, { base: 0, from: 5, arab: true }], // CAF Confederation Cup
  ...[900001, 900002, 900003, 900004, 900005, 900006, 900007, 900008, 900009].map(
    (id) => [id, { base: 0, from: 7, arab: true }], // Arab domestic cups
  ),
]);

/** Below this a tournament day is not worth a reminder. */
const THRESHOLD = 50;
/** Finals of these go past the weekly cap: World Cup, Champions League. */
const UNCAPPED_FINALS = new Set([1, 2]);
/** Reminders per audience in any seven days (bar those finals). */
const WEEKLY_CAP = 2;
/** Sent when the day's big match is at most this far away... */
const LEAD_MS = 60 * 60 * 1000;
/** ...and not once it is closer than this: a reminder at kick-off is late. */
const MIN_LEAD_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** How long after their last open an install still gets reminders. */
const AWAY_WINDOW_DAYS = 45;
/** FCM allows at most five topics in one condition. */
const TOPICS_PER_MESSAGE = 5;

const AUDIENCES = ['arab', 'world'];

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Days since 1970-01-01 (UTC): the number in an `away_` topic. */
const dayIndex = (ms) => Math.floor(ms / DAY_MS);

/** How deep in a knockout competition: 7 final, 5 semi, 4 quarter, 3 last 16. */
function stage(round) {
  const text = String(round || '').toLowerCase();
  if (/3rd|third/.test(text)) return 0;
  if (/semi/.test(text)) return 5;
  if (/quarter/.test(text)) return 4;
  if (/round of 16|last 16|1\/8|eighth/.test(text)) return 3;
  if (/final/.test(text)) return 7;
  return 0;
}

const STAGE_POINTS = { 7: 50, 5: 30, 4: 20, 3: 10 };

const isArabTeam = (id) => ARAB_NATIONS.has(id) || ARAB_CLUBS.has(id);

/**
 * How big one match is for this audience, within its tournament; null when
 * this audience must not hear about it at all.
 */
function matchScore(fixture, audience) {
  const home = fixture.teams.home.id;
  const away = fixture.teams.away.id;
  const arab = audience === 'arab';
  if (!arab && (isArabTeam(home) || isArabTeam(away))) return null;
  const count = (set) => (set.has(home) ? 1 : 0) + (set.has(away) ? 1 : 0);
  let points = STAGE_POINTS[stage(fixture.league.round)] || 0;
  points += count(BIG_CLUBS) * 10 + count(BIG_NATIONS) * 10;
  if (arab) points += count(ARAB_CLUBS) * 15 + count(ARAB_NATIONS) * 20;
  if (DERBY.has(home < away ? `${home}-${away}` : `${away}-${home}`)) {
    points += 15;
  }
  return points;
}

/**
 * Each tournament playing today that this audience may hear about, with its
 * one highlight: the biggest match still to come. Best day first.
 */
function tournamentDays(fixtures, audience, today) {
  const byLeague = new Map();
  for (const fixture of fixtures) {
    if (dayKey(fixture.fixture.timestamp * 1000) !== today) continue;
    const tournament = TOURNAMENTS.get(fixture.league.id);
    if (!tournament || (tournament.arab && audience !== 'arab')) continue;
    if (tournament.from && stage(fixture.league.round) < tournament.from) {
      continue;
    }
    const points = matchScore(fixture, audience);
    if (points == null) continue;
    const list = byLeague.get(fixture.league.id) || [];
    list.push({ fixture, points });
    byLeague.set(fixture.league.id, list);
  }
  const days = [];
  for (const [leagueId, matches] of byLeague) {
    const upcoming = matches
      .filter((m) => m.fixture.fixture.status.short === 'NS')
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.fixture.fixture.timestamp - b.fixture.fixture.timestamp,
      );
    if (!upcoming.length) continue;
    const best = upcoming[0];
    days.push({
      leagueId,
      fixture: best.fixture,
      score: TOURNAMENTS.get(leagueId).base + best.points,
    });
  }
  return days.sort((a, b) => b.score - a.score);
}

/**
 * Which reminders to send now, and the state to save with them.
 *
 * [saved] is what an earlier check saved (`{ arab: { day, sent: [ms] }, ... }`).
 * A reminder is only sent once that new state has been saved, so two
 * overlapping checks cannot both send it (see alerts.tick).
 */
function plan(fixtures, saved, now) {
  const today = dayKey(now);
  const next = {};
  const picks = [];
  for (const audience of AUDIENCES) {
    const before = (saved && saved[audience]) || {};
    const record = {
      day: before.day || null,
      sent: (before.sent || []).filter((t) => now - t < WEEK_MS),
    };
    next[audience] = record;
    if (record.day === today) continue;

    // The day's best tournament, waiting for its big match to come close.
    const best = tournamentDays(fixtures, audience, today)[0];
    if (!best || best.score < THRESHOLD) continue;
    const lead = best.fixture.fixture.timestamp * 1000 - now;
    if (lead > LEAD_MS || lead < MIN_LEAD_MS) continue;

    // Over the weekly cap: today is done, without a reminder.
    record.day = today;
    const uncapped =
      UNCAPPED_FINALS.has(best.leagueId) && stage(best.fixture.league.round) === 7;
    if (record.sent.length >= WEEKLY_CAP && !uncapped) continue;
    record.sent.push(now);
    picks.push({ audience, fixture: best.fixture, score: best.score });
    // Recorded in `day` only once sent or capped, so a later, bigger day is
    // never shut out by a smaller one this morning.
  }
  return { next, picks };
}

/** The `away_` topics a reminder sent at [now] goes to, five per condition. */
function awayConditions(audience, now) {
  const today = dayIndex(now);
  const topics = [];
  for (let day = today; day > today - AWAY_WINDOW_DAYS; day -= 1) {
    topics.push(`away_${audience}_${day}`);
  }
  const out = [];
  for (let i = 0; i < topics.length; i += TOPICS_PER_MESSAGE) {
    out.push(
      topics
        .slice(i, i + TOPICS_PER_MESSAGE)
        .map((topic) => `'${topic}' in topics`)
        .join(' || '),
    );
  }
  return out;
}

/**
 * The reminder as a notification the phone shows by itself, in its own
 * language: `push_bigmatch_title` ("Champions League today") takes the
 * tournament, `push_bigmatch_body` ("Big match: Real Madrid – Man City") the
 * teams, each given in English and Arabic as the match alerts are.
 * Without a target: the caller adds a `condition` or a `topic`.
 */
function notification(fixture, arabic) {
  const home = fixture.teams.home.name || '';
  const away = fixture.teams.away.name || '';
  const homeAr = (arabic && arabic.teams.home.name) || home;
  const awayAr = (arabic && arabic.teams.away.name) || away;
  const league = fixture.league.name || '';
  const leagueAr = (arabic && arabic.league.name) || league;
  const matchId = String(fixture.fixture.id);
  const kickoff = fixture.fixture.timestamp;
  const titleArgs = [league, leagueAr];
  const bodyArgs = [home, homeAr, away, awayAr];
  // Pointless once the match has started.
  const ttl = Math.max(60, kickoff - Math.floor(Date.now() / 1000));
  return {
    data: {
      type: 'bigmatch',
      matchId,
      leagueId: String(fixture.league.id),
      homeId: String(fixture.teams.home.id),
      awayId: String(fixture.teams.away.id),
      home,
      away,
      homeAr,
      awayAr,
      league,
      leagueAr,
      kickoff: String(kickoff),
    },
    android: {
      priority: 'HIGH',
      ttl: `${ttl}s`,
      notification: {
        title_loc_key: 'push_bigmatch_title',
        title_loc_args: titleArgs,
        body_loc_key: 'push_bigmatch_body',
        body_loc_args: bodyArgs,
        channel_id: 'match_alerts',
        icon: 'ic_stat_alert',
        color: '#16A34A',
        sound: 'default',
        // The kick-off alert of a followed match replaces it.
        tag: `match_${matchId}`,
      },
    },
    apns: {
      headers: {
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(kickoff),
        'apns-collapse-id': `match_${matchId}`,
      },
      payload: {
        aps: {
          alert: {
            'title-loc-key': 'push_bigmatch_title',
            'title-loc-args': titleArgs,
            'loc-key': 'push_bigmatch_body',
            'loc-args': bodyArgs,
          },
          sound: 'default',
          'thread-id': `match_${matchId}`,
        },
      },
    },
  };
}

/** Every message one reminder takes: one per condition of `away_` topics. */
function messages(fixture, arabic, audience, now) {
  return awayConditions(audience, now).map((condition) => ({
    condition,
    ...notification(fixture, arabic),
  }));
}

module.exports = {
  plan,
  tournamentDays,
  matchScore,
  stage,
  messages,
  notification,
  awayConditions,
  dayIndex,
  AUDIENCES,
};
