/**
 * BBC Sport -> API-Football shape.
 *
 * Everything downstream was written against API-Football's structure, so the
 * translation happens here and the source stays invisible to consumers.
 */

const { stableId } = require('./leagues');

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Minute from a BBC period label.
 *
 * The label is already football-shaped: "35'", "90'+7", "HT". Stoppage time is
 * folded into the total, which is what a minute indicator should show.
 */
function parseMinute(label) {
  const text = String(label || '').trim();
  const match = /(\d+)'?\s*(?:\+\s*(\d+))?/.exec(text);
  if (!match) return null;
  const base = Number(match[1]);
  const extra = match[2] ? Number(match[2]) : 0;
  return Number.isFinite(base) ? base + extra : null;
}

/**
 * BBC status -> API-Football status code.
 *
 * `status` gives the coarse phase (PreEvent / MidEvent / PostEvent / Postponed)
 * and `periodLabel` the detail, including the live minute. Both are read because
 * the phase alone cannot distinguish half-time from the 35th minute, and cannot
 * distinguish a normal full time from one after extra time.
 */
function mapStatus(event) {
  const status = String(event.status || '');
  const label = String(
    (event.periodLabel && event.periodLabel.value) ||
      (event.statusComment && event.statusComment.value) ||
      ''
  ).toLowerCase();

  if (status === 'Postponed' || label.includes('postpon')) return 'PST';
  if (label.includes('abandon')) return 'ABD';
  if (label.includes('cancel')) return 'CANC';
  if (label.includes('awarded') || label.includes('walkover')) return 'AWD';

  if (status === 'PreEvent') return 'NS';

  if (status === 'MidEvent') {
    if (label.includes('half time') || label === 'ht') return 'HT';
    if (label.includes('penalt') || label.includes('shootout')) return 'PEN';
    if (label.includes('et') || label.includes('extra')) return 'ET';
    const minute = parseMinute(label);
    return minute !== null && minute > 45 ? '2H' : '1H';
  }

  if (status === 'PostEvent') {
    if (label.includes('pens') || label.includes('penalt')) return 'PEN';
    if (label.includes('aet') || label.includes('extra')) return 'AET';
    return 'FT';
  }

  return 'NS';
}

/** BBC `urn` is the stable identity; the slug tail is the readable part. */
function teamFrom(side) {
  if (!side) return { id: null, name: null, logo: null, winner: null };
  const name = side.fullName || side.shortName || null;
  return {
    id: stableId(side.urn || side.id || name),
    name,
    // BBC's embedded data carries no crest URLs at all. Null rather than a
    // guessed URL, so the UI falls back to initials instead of a broken image.
    logo: null,
    winner: null,
  };
}

/** Running scores give a genuine half-time score. */
const halftime = (side) =>
  num(side && side.runningScores && side.runningScores.halftime);

/**
 * "England - FA Cup - 1st Round Qualifying Replays" -> the trailing round.
 * Falls back to the secondary group label the caller passes in.
 */
function roundFrom(event, groupLabel) {
  const parts = String(event.eventGroupingLabel || '')
    .split(' - ')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 3) return parts.slice(2).join(' - ');
  return groupLabel || null;
}

/** One BBC event -> one API-Football fixture object. */
function fixture(event, league, groupLabel) {
  const short = mapStatus(event);
  const started = !['NS', 'PST', 'CANC'].includes(short);
  const finished = ['FT', 'AET', 'PEN', 'AWD'].includes(short);
  const label =
    (event.periodLabel && event.periodLabel.value) ||
    (event.statusComment && event.statusComment.value) ||
    '';

  const home = event.home || {};
  const away = event.away || {};
  const iso = event.startDateTime || (event.date && event.date.iso) || null;

  return {
    fixture: {
      // BBC ids are strings ("s-57bwm5..."), so a numeric id is derived. The
      // original is kept alongside for debugging and for re-lookups.
      id: stableId(event.id || event.urn),
      sourceId: event.id || event.urn || null,
      referee: null,
      timezone: 'UTC',
      date: iso,
      timestamp: iso ? Math.floor(Date.parse(iso) / 1000) : null,
      // Not present anywhere in BBC's embedded data.
      venue: { id: null, name: null, city: null },
      status: {
        long: (event.statusComment && event.statusComment.accessible) || null,
        short,
        elapsed: short === 'NS' ? null : parseMinute(label),
      },
    },
    league: {
      id: league.apiFootballId,
      name: league.name,
      country: league.country,
      logo: null,
      flag: null,
      season: null,
      round: roundFrom(event, groupLabel),
    },
    teams: { home: teamFrom(home), away: teamFrom(away) },
    goals: {
      home: started ? num(home.score) : null,
      away: started ? num(away.score) : null,
    },
    score: {
      halftime: {
        home: started ? halftime(home) : null,
        away: started ? halftime(away) : null,
      },
      fulltime: {
        home: finished ? num(home.score) : null,
        away: finished ? num(away.score) : null,
      },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

/**
 * BBC per-side `actions` -> API-Football `events`.
 *
 * BBC nests them: one entry per player, each holding a list of that player's
 * actions with their own minute. Flattening gives the chronological feed the
 * API-Football shape implies.
 */
function events(event) {
  const out = [];

  for (const which of ['home', 'away']) {
    const side = event[which] || {};
    const team = teamFrom(side);

    for (const entry of side.actions || []) {
      /**
       * `actionType` is BBC's coarse category ("goal", "card") and `type` the
       * specific label. Both are read, because the labels do NOT all contain the
       * word they describe: a penalty goal is typed simply "Penalty", so
       * matching on "goal" alone silently drops it — the bug that made a 2-3
       * scoreline list only four scorers.
       */
      const category = String(entry.actionType || '').toLowerCase();

      for (const action of entry.actions || []) {
        const type = String(action.type || '').toLowerCase();
        const minuteLabel = (action.timeLabel && action.timeLabel.value) || '';
        const match = /(\d+)'?\s*(?:\+\s*(\d+))?/.exec(minuteLabel);

        // A miss is not a goal, and a shootout kick is not part of the score.
        if (/miss|saved|shootout/.test(type)) continue;

        let kind = null;
        let detail = null;
        if (type.includes('own')) {
          kind = 'Goal';
          detail = 'Own Goal';
        } else if (type.includes('penalt')) {
          kind = 'Goal';
          detail = 'Penalty';
        } else if (type.includes('goal')) {
          kind = 'Goal';
          detail = 'Normal Goal';
        } else if (type.includes('red')) {
          kind = 'Card';
          detail = 'Red Card';
        } else if (type.includes('yellow')) {
          kind = 'Card';
          detail = 'Yellow Card';
        } else if (category === 'goal') {
          // Unrecognised label under a goal entry: count it rather than lose a
          // goal, so a new BBC label degrades to "Normal Goal" instead of
          // vanishing from the feed.
          kind = 'Goal';
          detail = 'Normal Goal';
        } else {
          continue;
        }

        out.push({
          time: {
            elapsed: match ? Number(match[1]) : null,
            extra: match && match[2] ? Number(match[2]) : null,
          },
          team: { id: team.id, name: team.name, logo: null },
          player: {
            id: entry.playerUrn ? stableId(entry.playerUrn) : null,
            name: entry.playerName || null,
          },
          assist: { id: null, name: null },
          type: kind,
          detail,
          comments: null,
          isHome: which === 'home',
        });
      }
    }
  }

  out.sort(
    (a, b) =>
      (a.time.elapsed || 0) +
      (a.time.extra || 0) / 100 -
      ((b.time.elapsed || 0) + (b.time.extra || 0) / 100)
  );
  return out;
}

/** One BBC table row -> one API-Football standings row. */
function standingRow(row, groupName) {
  const name = row.name || row.shortName || null;
  return {
    rank: num(row.rank),
    team: {
      id: stableId(row.urn || name),
      name,
      logo: null,
    },
    points: num(row.points),
    goalsDiff: num(row.goalDifference),
    group: groupName,
    // BBC supplies a six-match form guide; the most recent five is the
    // conventional presentation.
    form:
      (row.formGuide || [])
        .map((f) => f.value)
        .filter((v) => v && v !== '-')
        .slice(-5)
        .join('') || null,
    status: null,
    // The qualification zone ("UEFA Champions League", "Relegation").
    description: row.rankStatus || null,
    all: {
      played: num(row.matchesPlayed),
      win: num(row.wins),
      draw: num(row.draws),
      lose: num(row.losses),
      goals: {
        for: num(row.goalsScoredFor),
        against: num(row.goalsScoredAgainst),
      },
    },
    home: null,
    away: null,
    update: null,
  };
}

module.exports = {
  num,
  parseMinute,
  mapStatus,
  fixture,
  events,
  standingRow,
  teamFrom,
};
