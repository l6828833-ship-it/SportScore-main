/**
 * ESPN -> API-Football shape.
 *
 * Everything downstream of this server was written against API-Football's
 * response structure. Reshaping here rather than in the consumer means the two
 * sources are interchangeable and the client needs no knowledge of which is
 * active.
 */

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * ESPN status -> API-Football status code.
 *
 * `type.state` is the coarse phase (pre/in/post) and `type.name` the detail.
 * The period disambiguates first half from second, which matters because the
 * consumer derives half-time from the code alone.
 */
function mapStatus(status) {
  const type = (status && status.type) || {};
  const name = String(type.name || '').toUpperCase();
  const state = String(type.state || '').toLowerCase();
  const period = num(status && status.period) || 0;

  if (name.includes('HALFTIME')) return 'HT';
  if (name.includes('POSTPONED')) return 'PST';
  if (name.includes('CANCEL')) return 'CANC';
  if (name.includes('ABANDON')) return 'ABD';
  if (name.includes('FORFEIT') || name.includes('AWARDED')) return 'AWD';
  if (name.includes('DELAY') || name.includes('SUSPEND')) return 'SUSP';
  if (name.includes('SHOOTOUT') || name.includes('PENALTIES')) return 'PEN';

  if (state === 'pre') return name.includes('TBD') ? 'TBD' : 'NS';
  if (state === 'post') {
    if (name.includes('EXTRATIME') || period > 2) return 'AET';
    return 'FT';
  }
  if (state === 'in') {
    if (period >= 3) return 'ET';
    return period >= 2 ? '2H' : '1H';
  }
  return 'NS';
}

/**
 * Elapsed minutes from ESPN's display clock.
 *
 * `displayClock` is authoritative and already football-shaped ("67'",
 * "90'+7'"). The numeric `clock` field is seconds and does not account for
 * stoppage the same way, so the display string is parsed instead. Stoppage is
 * folded into the total, which is what a minute indicator should show.
 */
function elapsedMinutes(status) {
  const display = String((status && status.displayClock) || '').trim();
  const match = /(\d+)'?(?:\s*\+\s*(\d+))?/.exec(display);
  if (match) {
    const base = Number(match[1]);
    const extra = match[2] ? Number(match[2]) : 0;
    if (Number.isFinite(base)) return base + extra;
  }
  const seconds = num(status && status.clock);
  return seconds !== null ? Math.round(seconds / 60) : null;
}

/** "13'" -> {elapsed:13, extra:null};  "90'+6'" -> {elapsed:90, extra:6} */
function parseEventClock(clock) {
  const display = String((clock && clock.displayValue) || '').trim();
  const match = /(\d+)'?(?:\s*\+\s*(\d+))?/.exec(display);
  if (!match) {
    const seconds = num(clock && clock.value);
    return {
      elapsed: seconds !== null ? Math.round(seconds / 60) : 0,
      extra: null,
    };
  }
  return {
    elapsed: Number(match[1]),
    extra: match[2] ? Number(match[2]) : null,
  };
}

const side = (competitors, which) =>
  (competitors || []).find((c) => c.homeAway === which) || null;

function team(competitor) {
  if (!competitor) return { id: null, name: null, logo: null, winner: null };
  const t = competitor.team || {};
  return {
    id: num(t.id),
    name: t.displayName || t.shortDisplayName || t.name || null,
    logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || null,
    winner: typeof competitor.winner === 'boolean' ? competitor.winner : null,
  };
}

/** Period scores, when ESPN supplies them, give a real half-time score. */
function halftimeFrom(competitor) {
  const lines = (competitor && competitor.linescores) || [];
  if (lines.length === 0) return null;
  return num(
    lines[0].displayValue !== undefined ? lines[0].displayValue : lines[0].value
  );
}

/**
 * `notes` carries the round label ("Matchday 3", "Round of 16") for cups and
 * group stages. Falls back to null rather than inventing one.
 */
function roundLabel(competition) {
  const notes = (competition && competition.notes) || [];
  for (const note of notes) {
    const text = note.headline || note.type || '';
    if (text) return String(text).trim();
  }
  return null;
}

/** One ESPN event -> one API-Football fixture object. */
function fixture(event, leagueMeta, espnLeague) {
  const competition = (event.competitions && event.competitions[0]) || {};
  const competitors = competition.competitors || [];
  const home = side(competitors, 'home');
  const away = side(competitors, 'away');

  const status = event.status || competition.status || {};
  const short = mapStatus(status);
  const started =
    short !== 'NS' && short !== 'TBD' && short !== 'PST' && short !== 'CANC';

  const officials = competition.officials || [];
  const referee =
    officials.length > 0
      ? officials[0].displayName || officials[0].fullName || null
      : null;

  const venue = competition.venue || event.venue || null;

  return {
    fixture: {
      id: num(event.id),
      referee,
      timezone: 'UTC',
      date: event.date || competition.date || null,
      timestamp: event.date ? Math.floor(Date.parse(event.date) / 1000) : null,
      venue: venue
        ? {
            id: num(venue.id),
            name: venue.fullName || venue.shortName || null,
            city: (venue.address && venue.address.city) || null,
          }
        : { id: null, name: null, city: null },
      status: {
        long: (status.type && status.type.description) || null,
        short,
        // Only meaningful while playing; a finished match has no running clock.
        elapsed:
          short === 'NS' || short === 'TBD' ? null : elapsedMinutes(status),
      },
    },
    league: {
      // API-Football's id, so consumers resolve the competition identically
      // regardless of which source produced this.
      id: leagueMeta.apiFootballId,
      name: leagueMeta.name,
      country: leagueMeta.country,
      logo:
        (espnLeague &&
          espnLeague.logos &&
          espnLeague.logos[0] &&
          espnLeague.logos[0].href) ||
        null,
      flag: null,
      season:
        (espnLeague && espnLeague.season && num(espnLeague.season.year)) ||
        null,
      round: roundLabel(competition),
    },
    teams: { home: team(home), away: team(away) },
    // Before kickoff ESPN reports "0", which must not be mistaken for a result.
    goals: {
      home: started ? num(home && home.score) : null,
      away: started ? num(away && away.score) : null,
    },
    score: {
      halftime: {
        home: started ? halftimeFrom(home) : null,
        away: started ? halftimeFrom(away) : null,
      },
      fulltime: {
        home:
          short === 'FT' || short === 'AET' || short === 'PEN'
            ? num(home && home.score)
            : null,
        away:
          short === 'FT' || short === 'AET' || short === 'PEN'
            ? num(away && away.score)
            : null,
      },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

/**
 * ESPN `details` -> API-Football `events`.
 *
 * Only the scoreboard feed carries `athletesInvolved`; the summary's copy of the
 * same list has it emptied, which is why the scoreboard is the source for
 * scorer names.
 */
function events(details, homeTeamId) {
  return (details || [])
    .map((detail) => {
      const { elapsed, extra } = parseEventClock(detail.clock);
      const athletes = detail.athletesInvolved || [];
      const teamId = num(detail.team && detail.team.id);

      let type = null;
      let label = null;
      if (detail.scoringPlay) {
        type = 'Goal';
        label = detail.ownGoal
          ? 'Own Goal'
          : detail.penaltyKick
            ? 'Penalty'
            : 'Normal Goal';
      } else if (detail.redCard) {
        type = 'Card';
        label = 'Red Card';
      } else if (detail.yellowCard) {
        type = 'Card';
        label = 'Yellow Card';
      } else {
        return null;
      }

      return {
        time: { elapsed, extra },
        team: { id: teamId, name: null, logo: null },
        player: {
          id: athletes[0] ? num(athletes[0].id) : null,
          name: athletes[0] ? athletes[0].displayName || null : null,
        },
        assist: {
          id: athletes[1] ? num(athletes[1].id) : null,
          name: athletes[1] ? athletes[1].displayName || null : null,
        },
        type,
        detail: label,
        comments: null,
        // Kept so a consumer can tell sides apart without re-deriving it.
        isHome: homeTeamId !== null && teamId === homeTeamId,
      };
    })
    .filter(Boolean);
}

/** ESPN boxscore stat keys -> API-Football `type` labels. */
const STAT_MAP = {
  possessionPct: 'Ball Possession',
  totalShots: 'Total Shots',
  shotsOnTarget: 'Shots on Goal',
  yellowCards: 'Yellow Cards',
  redCards: 'Red Cards',
  wonCorners: 'Corner Kicks',
  foulsCommitted: 'Fouls',
  offsides: 'Offsides',
  saves: 'Goalkeeper Saves',
  accuratePasses: 'Passes accurate',
  totalPasses: 'Total passes',
  blockedShots: 'Blocked Shots',
};

/** ESPN boxscore -> API-Football `statistics`. */
function statistics(boxscoreTeams) {
  return (boxscoreTeams || []).map((entry) => {
    const t = entry.team || {};
    const stats = (entry.statistics || [])
      .filter((stat) => STAT_MAP[stat.name])
      .map((stat) => {
        const label = STAT_MAP[stat.name];
        const raw = stat.displayValue;
        return {
          type: label,
          // Possession reads as a percentage everywhere else, so it keeps the
          // "%" suffix the consumer already knows how to parse.
          value: label === 'Ball Possession' ? `${raw}%` : num(raw),
        };
      });

    return {
      team: {
        id: num(t.id),
        name: t.displayName || t.shortDisplayName || null,
        logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || null,
      },
      statistics: stats,
    };
  });
}

module.exports = {
  num,
  mapStatus,
  elapsedMinutes,
  parseEventClock,
  fixture,
  events,
  statistics,
  halftimeFrom,
};
