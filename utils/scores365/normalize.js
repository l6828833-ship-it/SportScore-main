/**
 * 365scores -> API-Football shape.
 *
 * Keeps this server's single response contract, so a consumer cannot tell
 * 365scores from the LiveScore/scrape/ESPN/API-Football sources.
 */

const { toExposedId } = require('./leagues');

const IMAGE_BASE =
  process.env.SCORES365_IMAGE_BASE ||
  'https://imagecache.365scores.com/image/upload/f_png,w_80,h_80,c_limit,q_auto:eco,dpr_2/v1';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A goal count from 365scores. Like `num`, but a negative value is 365scores'
 * "no score" sentinel (-1), not a real result, so it collapses to null.
 */
const score = (v) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};

/** Competitor (team) logo from its id. */
function competitorLogo(id) {
  return id ? `${IMAGE_BASE}/Competitors/${id}` : null;
}

/** Competition logo from its 365scores id. */
function competitionLogo(scores365Id) {
  return scores365Id ? `${IMAGE_BASE}/Competitions/${scores365Id}` : null;
}

/** Athlete (player) headshot from its id. */
function athleteImage(id) {
  return id ? `${IMAGE_BASE}/Athletes/${id}` : null;
}

/**
 * 365scores status -> API-Football short code.
 *
 * `statusGroup` is the reliable signal: 2 scheduled, 3 live, 4 finished. The
 * text is used only to separate the finer states (half time, extra time,
 * postponed, cancelled) that share a group.
 */
function mapStatus(game) {
  const group = Number(game.statusGroup);
  const text = String(game.statusText || game.shortStatusText || '')
    .trim()
    .toLowerCase();

  // The abnormal states (postponed, cancelled, abandoned, suspended) share
  // statusGroup 4 with a normal "finished", so ONLY the text separates them —
  // and the text is localized. With langId=27 it arrives in Arabic, so matching
  // English alone silently let a postponed game ("تأجلت") fall through to "FT"
  // and show as finished with a placeholder score. Match both languages.
  if (/postpon|تأجل|مؤجل/.test(text)) return 'PST';
  if (/cancel|ألغ|ملغا/.test(text)) return 'CANC';
  if (/aband|توقف|أوقف/.test(text)) return 'ABD';
  if (/suspend|معلّق|معلق/.test(text)) return 'SUSP';

  if (group === 4) {
    if (/penalt|ركلات|جزاء/.test(text)) return 'PEN';
    if (/after et|a\.e\.t|aet|بعد التمديد|وقت إضافي/.test(text)) return 'AET';
    return 'FT';
  }
  if (group === 3) {
    if (/half\s*time|halftime|\bht\b|الشوطين|بين الشوطين|استراحة/.test(text)) return 'HT';
    if (/extra|إضافي|التمديد/.test(text)) return 'ET';
    if (/penalt|ركلات|جزاء/.test(text)) return 'P';
    if (/1st half|first half|الشوط الأول/.test(text)) return '1H';
    if (/2nd half|second half|الشوط الثاني/.test(text)) return '2H';
    return 'LIVE';
  }
  return 'NS';
}

/** Live minute from `gameTime` (a float like 76.0) or the display "76'". */
function liveMinute(game) {
  const gt = num(game.gameTime);
  if (gt != null && gt > 0) return Math.floor(gt);
  const m = /(\d+)/.exec(String(game.gameTimeDisplay || ''));
  return m ? Number(m[1]) : null;
}

function team(competitor) {
  if (!competitor) return { id: null, name: null, logo: null, winner: null };
  return {
    id: num(competitor.id),
    name: competitor.name || competitor.shortName || null,
    logo: competitorLogo(competitor.id),
    winner:
      competitor.isWinner === true
        ? true
        : competitor.isWinner === false
          ? false
          : null,
  };
}

/**
 * TV channels carrying a match, from 365scores' `tvNetworks`.
 *
 * Real per-fixture broadcast data, which is worth stating plainly because no
 * mainstream football API exposes it: on a Champions League matchday the nine
 * simultaneous kickoffs are split across beIN SPORTS 1-9, and this is the only
 * source wired into this server that says which match is on which number.
 *
 * Only present on the `/game/` endpoint, and only when it is queried as a
 * country the rights cover (see TV_COUNTRY_ID in the client) — the games list
 * carries a bare `hasTVNetworks` flag and a null array.
 *
 * Names arrive as broadcast branding, e.g. "beIN Sport 1 HD". Returned as-is:
 * normalizing them is a display decision and belongs in the consumer.
 */
function tvChannels(game) {
  const networks = Array.isArray(game && game.tvNetworks) ? game.tvNetworks : [];
  const names = networks
    .map((n) => (n && typeof n.name === 'string' ? n.name.trim() : ''))
    .filter(Boolean);
  // Deduplicate: a match can be listed against the same channel more than once
  // when several territories map onto it.
  return [...new Set(names)];
}

/**
 * The knockout round, or the group, that a game belongs to.
 *
 * Both are localized free text from the source, which is fine — the consumer
 * displays them and matches them against patterns in the same language. What
 * matters here is the ORDER: `stageName` identifies a knockout round and only
 * appears on knockout games, so it wins; `groupName` labels a group-stage game;
 * `roundName` is deliberately not consulted, because on this source it is the
 * same generic word for every game in a competition.
 */
function stageOrGroupName(game) {
  const stage = typeof game.stageName === 'string' ? game.stageName.trim() : '';
  if (stage) return stage;
  const group = typeof game.groupName === 'string' ? game.groupName.trim() : '';
  return group || null;
}

/** One 365scores game -> one API-Football fixture. */
function fixture(game) {
  const short = mapStatus(game);
  const started = !['NS', 'PST', 'CANC'].includes(short);
  const finished = ['FT', 'AET', 'PEN'].includes(short);
  const iso = game.startTime ? new Date(game.startTime).toISOString() : null;
  const exposedLeagueId = toExposedId(game.competitionId);
  // 365scores uses -1 as a "no score" sentinel (e.g. a postponed or not-yet-
  // played game). `num` accepts it as a valid number, so it must be filtered
  // here, or a match with no result renders a literal "-1 : -1".
  const hg = score(game.homeCompetitor && game.homeCompetitor.score);
  const ag = score(game.awayCompetitor && game.awayCompetitor.score);

  return {
    fixture: {
      id: num(game.id),
      referee: null,
      timezone: 'UTC',
      date: iso,
      timestamp: iso ? Math.floor(Date.parse(iso) / 1000) : null,
      venue: game.venue
        ? {
            id: null,
            name: game.venue.name || null,
            city: game.venue.shortName || null,
          }
        : { id: null, name: null, city: null },
      status: {
        long: game.statusText || null,
        short,
        elapsed: short === 'NS' ? null : liveMinute(game),
      },
      /**
       * Broadcasters for THIS fixture. Empty for a list response, which does not
       * carry them; populated on the single-game endpoint.
       *
       * Not part of API-Football's fixture shape — an addition, kept here beside
       * `venue` and `referee` because it is the same class of per-match detail.
       */
      tv_channels: tvChannels(game),
    },
    league: {
      id: exposedLeagueId,
      name: game.competitionDisplayName || null,
      country: null,
      logo: competitionLogo(game.competitionId),
      flag: null,
      season: num(game.seasonNum),
      /**
       * The phase this game belongs to: a knockout round, a group, or a matchday.
       *
       * `stageName` FIRST, because that is where the knockout round lives —
       * "دور الـ 16", "ربع النهائي", "نصف النهائي", "النهائي". `roundName` was
       * being used instead, and on this source it is the generic word "الجولة"
       * for every game in the competition: the old English test
       * (`!== 'round'`) never matched an Arabic string, so every fixture came out
       * labelled "الجولة" and nothing downstream could tell a final from a group
       * game. That is why the World Cup showed no bracket.
       *
       * Then `groupName` ("المجموعة أ") for a group stage, then the matchday
       * number for a plain league. A bare "الجولة"/"round" with no number carries
       * no information and is dropped, so consumers see null rather than a label
       * that means nothing.
       */
      round:
        stageOrGroupName(game) ??
        (game.roundNum ? `Round ${game.roundNum}` : null),
    },
    teams: { home: team(game.homeCompetitor), away: team(game.awayCompetitor) },
    goals: {
      home: started ? hg : null,
      away: started ? ag : null,
    },
    score: {
      halftime: halftimeFromStages(game),
      fulltime: {
        home: finished ? hg : null,
        away: finished ? ag : null,
      },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

/** Half-time score, when the game detail carries per-stage scores. */
function halftimeFromStages(game) {
  const stages = Array.isArray(game.stages) ? game.stages : [];
  const ht = stages.find((s) =>
    /halftime|half time|\bht\b/i.test(s.name || s.shortName || '')
  );
  if (!ht) return { home: null, away: null };
  return {
    home: score(ht.homeCompetitorScore),
    away: score(ht.awayCompetitorScore),
  };
}

/**
 * Event type ids, which are the ONLY language-independent way to classify an
 * event.
 *
 * `eventType.name` and `subTypeName` are LOCALIZED: with the default Arabic
 * `langId` (27) a goal arrives as "هدف", not "Goal". Matching on the English
 * text therefore discarded every goal on every game — no scorers on a match
 * page, and an empty computed leaderboard for the cups. The numeric ids are
 * stable across languages, verified against 60 finished games:
 *
 *   eventType.id  1 Goal   2 Yellow Card   3 Red Card
 *                 6 Penalty Miss   11 Goal Disallowed (VAR)   12 Woodwork
 *   subTypeId (on a Goal)  1 Field Goal   2 Own Goal   3 Penalty
 *
 * Note 11 (Goal Disallowed) is its own type, so an id test cannot mistake a
 * chalked-off goal for a real one.
 */
const EVENT_TYPE_GOAL = 1;
const EVENT_TYPE_YELLOW = 2;
const EVENT_TYPE_RED = 3;
const EVENT_TYPE_PENALTY_MISS = 6;
const EVENT_TYPE_GOAL_DISALLOWED = 11;
const GOAL_SUBTYPE_OWN = 2;
const GOAL_SUBTYPE_PENALTY = 3;
/** A red card shown for a second bookable offence rather than straight. */
const RED_SUBTYPE_SECOND_YELLOW = 21;

/**
 * What this event is, in API-Football's `type` / `detail` vocabulary.
 *
 * Only goals used to be emitted, so a match page could show who scored and
 * nothing else — no bookings, no missed penalties, no chalked-off goals. The
 * classification is by numeric id for the reason given above: the names are
 * localized, so testing them in English silently matched nothing.
 *
 * Returns null for events not worth a timeline row. Substitutions (1000) are
 * excluded deliberately: there are around ten a match and they would bury the
 * incidents among routine changes.
 */
function classifyEvent(eventType) {
  const typeId = num(eventType.id);
  const subTypeId = num(eventType.subTypeId);
  const subtype = String(eventType.subTypeName || '');

  switch (typeId) {
    case EVENT_TYPE_GOAL: {
      const own = subTypeId === GOAL_SUBTYPE_OWN || /own|عكس|ذاتي/i.test(subtype);
      const penalty =
        subTypeId === GOAL_SUBTYPE_PENALTY || /penalt|جزاء/i.test(subtype);
      return {
        type: 'Goal',
        detail: own ? 'Own Goal' : penalty ? 'Penalty' : 'Normal Goal',
      };
    }
    case EVENT_TYPE_YELLOW:
      return { type: 'Card', detail: 'Yellow Card' };
    case EVENT_TYPE_RED:
      return {
        type: 'Card',
        detail:
          subTypeId === RED_SUBTYPE_SECOND_YELLOW || /second|ثانية/i.test(subtype)
            ? 'Second Yellow card'
            : 'Red Card',
      };
    case EVENT_TYPE_PENALTY_MISS:
      return { type: 'Missed Penalty', detail: 'Missed Penalty' };
    case EVENT_TYPE_GOAL_DISALLOWED:
      return { type: 'Var', detail: 'Goal Disallowed' };
    default:
      return null;
  }
}

/**
 * Goal events from a game detail, resolved to player names.
 *
 * Each event references players by `members[].id`. Goals carry the scorer in
 * `playerId` and, when present, the assister as `extraPlayers[0]`. Own goals
 * and penalties are distinguished by the event subtype.
 */
function events(game) {
  const members = new Map(
    (game.members || []).map((m) => [m.id, m.name || m.shortName || null])
  );
  /**
   * Which team each player actually belongs to.
   *
   * Needed because of own goals. This source attributes an own-goal event to the
   * team that BENEFITS, not the team of the player who scored it — verified on a
   * Puebla-Toluca game where the scorer's `members[].competitorId` was Puebla
   * while the event's `competitorId` was Toluca. Passing that through meant a row
   * reading "Villalibre · Barcelona · own goal" for a player who does not play for
   * Barcelona.
   *
   * So `team` is normalized to mean one thing everywhere: the team of the player
   * the event is about, which is also API-Football's convention. Deciding which
   * side of a timeline an own goal belongs on is then the consumer's call, and it
   * has the information to make it.
   */
  const playerTeam = new Map(
    (game.members || [])
      .filter((m) => m && m.id != null && m.competitorId != null)
      .map((m) => [m.id, m.competitorId])
  );
  const homeId = game.homeCompetitor && game.homeCompetitor.id;
  const out = [];

  for (const ev of game.events || []) {
    const kind = classifyEvent(ev.eventType || {});
    if (!kind) continue;

    // The player's own team, falling back to the event's when the lineup does
    // not name them. Only own goals actually differ; for everything else the two
    // are the same team.
    const teamId = playerTeam.get(ev.playerId) ?? ev.competitorId;
    const isHome = teamId === homeId;
    // Only a goal carries an assister here; on a card the extra player slot is
    // either empty or unrelated, so it is read for goals alone.
    const assistId =
      kind.type === 'Goal' && Array.isArray(ev.extraPlayers)
        ? ev.extraPlayers[0]
        : null;

    out.push({
      time: { elapsed: num(ev.gameTime), extra: num(ev.addedTime) || null },
      team: {
        id: num(teamId),
        name: null,
        logo: competitorLogo(teamId),
      },
      player: { id: num(ev.playerId), name: members.get(ev.playerId) || null },
      assist: assistId
        ? { id: num(assistId), name: members.get(assistId) || null }
        : { id: null, name: null },
      type: kind.type,
      detail: kind.detail,
      comments: null,
      isHome,
    });
  }

  out.sort((a, b) => (a.time.elapsed || 0) - (b.time.elapsed || 0));
  return out;
}

/**
 * One standings row -> API-Football standings row.
 * `groupName` labels multi-group tables (cups); null for a single league table.
 */
function standingRow(row, groupName) {
  const c = row.competitor || {};
  const gf = num(row.for);
  const ga = num(row.against);
  return {
    rank: num(row.position),
    team: {
      id: num(c.id),
      name: c.name || c.shortName || null,
      logo: competitorLogo(c.id),
    },
    points: num(row.points),
    goalsDiff: gf != null && ga != null ? gf - ga : null,
    group: groupName,
    form: null,
    status: null,
    // 365scores does not label qualification zones in this payload, so no band.
    description: null,
    all: {
      played: num(row.gamePlayed),
      win: num(row.gamesWon),
      draw: num(row.gamesEven),
      lose: num(row.gamesLost),
      goals: { for: gf, against: ga },
    },
    home: null,
    away: null,
    update: null,
  };
}

module.exports = {
  num,
  competitorLogo,
  competitionLogo,
  athleteImage,
  mapStatus,
  liveMinute,
  fixture,
  tvChannels,
  events,
  standingRow,
};
