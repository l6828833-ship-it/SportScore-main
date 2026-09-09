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

  if (/postpon/.test(text)) return 'PST';
  if (/cancel/.test(text)) return 'CANC';
  if (/aband/.test(text)) return 'ABD';
  if (/suspend/.test(text)) return 'SUSP';

  if (group === 4) {
    if (/penalt/.test(text)) return 'PEN';
    if (/after et|a\.e\.t|aet/.test(text)) return 'AET';
    return 'FT';
  }
  if (group === 3) {
    if (/half\s*time|halftime|\bht\b/.test(text)) return 'HT';
    if (/extra/.test(text)) return 'ET';
    if (/penalt/.test(text)) return 'P';
    if (/1st half|first half/.test(text)) return '1H';
    if (/2nd half|second half/.test(text)) return '2H';
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

/** One 365scores game -> one API-Football fixture. */
function fixture(game) {
  const short = mapStatus(game);
  const started = !['NS', 'PST', 'CANC'].includes(short);
  const finished = ['FT', 'AET', 'PEN'].includes(short);
  const iso = game.startTime ? new Date(game.startTime).toISOString() : null;
  const exposedLeagueId = toExposedId(game.competitionId);
  const hg = num(game.homeCompetitor && game.homeCompetitor.score);
  const ag = num(game.awayCompetitor && game.awayCompetitor.score);

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
      // Round name for cups; a plain "Round" for leagues is dropped so the
      // standings phase filter and bracket logic behave like the other sources.
      round:
        game.roundName && game.roundName.toLowerCase() !== 'round'
          ? game.roundName
          : game.roundNum
            ? `Round ${game.roundNum}`
            : null,
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
    home: num(ht.homeCompetitorScore),
    away: num(ht.awayCompetitorScore),
  };
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
  const homeId = game.homeCompetitor && game.homeCompetitor.id;
  const out = [];

  for (const ev of game.events || []) {
    const type = ev.eventType && ev.eventType.name;
    if (type !== 'Goal') continue;
    const subtype = String((ev.eventType && ev.eventType.subTypeName) || '');
    const isHome = ev.competitorId === homeId;
    const assistId = Array.isArray(ev.extraPlayers) ? ev.extraPlayers[0] : null;

    out.push({
      time: { elapsed: num(ev.gameTime), extra: num(ev.addedTime) || null },
      team: {
        id: num(ev.competitorId),
        name: null,
        logo: competitorLogo(ev.competitorId),
      },
      player: { id: num(ev.playerId), name: members.get(ev.playerId) || null },
      assist: assistId
        ? { id: num(assistId), name: members.get(assistId) || null }
        : { id: null, name: null },
      type: 'Goal',
      detail: /own/i.test(subtype)
        ? 'Own Goal'
        : /penalt/i.test(subtype)
          ? 'Penalty'
          : 'Normal Goal',
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
