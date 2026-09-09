/**
 * LiveScore -> API-Football shape.
 *
 * Keeps this server's single response contract, so a consumer cannot tell
 * LiveScore from the scrape/ESPN/API-Football sources.
 */

const { resolveStage, stableId } = require('./leagues');

const norm = (v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** LiveScore team badge: "enet/8669.png" -> full CDN URL. */
function badge(img) {
  if (!img) return null;
  const path = String(img).replace(/^\/+/, '');
  return `https://lsm-static-prod.livescore.com/medium/${path}`;
}

/**
 * `Eps` is LiveScore's status. It is either a phrase (NS, HT, FT, Postp.,
 * Canc., Aband., AP, AET, Pen.) or the live minute itself ("39'", "90+2",
 * "45"). A numeric-looking value therefore means the match is in play.
 */
function mapStatus(eps) {
  const s = String(eps || '').trim();
  const up = s.toUpperCase();

  if (up === 'NS' || up === '' || up === 'TBD') return 'NS';
  if (up === 'HT') return 'HT';
  if (up === 'FT') return 'FT';
  if (up === 'AET') return 'AET';
  if (up === 'PEN.' || up === 'AP') return 'PEN';
  if (up.startsWith('POSTP')) return 'PST';
  if (up.startsWith('CANC')) return 'CANC';
  if (up.startsWith('ABAND')) return 'ABD';
  if (up.startsWith('SUSP')) return 'SUSP';

  // A minute ("39'", "90+2", "45") means live. Second half if > 45.
  const minute = liveMinute(eps);
  if (minute !== null) return minute > 45 ? '2H' : '1H';
  return 'NS';
}

/** Parse the live minute out of `Eps` ("39'", "90+2'"), else null. */
function liveMinute(eps) {
  const m = /(\d+)\s*(?:\+\s*(\d+))?/.exec(String(eps || ''));
  if (!m) return null;
  // Guard: don't treat a status word that happens to contain digits oddly.
  const base = Number(m[1]);
  const extra = m[2] ? Number(m[2]) : 0;
  return Number.isFinite(base) ? base + extra : null;
}

/** "20260913130000" -> ISO. */
function parseEsd(esd) {
  const s = String(esd || '');
  if (s.length < 8) return null;
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  const h = s.slice(8, 10) || '00';
  const mi = s.slice(10, 12) || '00';
  return `${y}-${mo}-${d}T${h}:${mi}:00Z`;
}

function team(side) {
  const t = Array.isArray(side) ? side[0] : side;
  if (!t) return { id: null, name: null, logo: null, winner: null };
  return {
    id: num(t.ID) ?? stableId(t.Nm),
    name: t.Nm || null,
    logo: badge(t.Img),
    winner: null,
  };
}

/** One LiveScore event -> one API-Football fixture. */
function fixture(event, stageDesc, stage) {
  const short = mapStatus(event.Eps);
  const started = !['NS', 'PST', 'CANC'].includes(short);
  const finished = ['FT', 'AET', 'PEN'].includes(short);
  const iso = parseEsd(event.Esd);

  return {
    fixture: {
      id: num(event.Eid) ?? stableId(String(event.Eid)),
      referee: null,
      timezone: 'UTC',
      date: iso,
      timestamp: iso ? Math.floor(Date.parse(iso) / 1000) : null,
      venue: event.Venue
        ? {
            id: null,
            name: event.Venue.Vnm || null,
            city: event.Venue.Cnm || null,
          }
        : { id: null, name: null, city: null },
      status: {
        long: String(event.Eps || '') || null,
        short,
        elapsed: short === 'NS' ? null : liveMinute(event.Eps),
      },
    },
    league: {
      id: stageDesc.id,
      name: stageDesc.name,
      country: stageDesc.country,
      logo: stage && stage.badgeUrl ? stage.badgeUrl : null,
      flag: null,
      season: null,
      // For cups, LiveScore puts the ROUND in the Stage name (Snm) — "League
      // Stage", "Play-offs", "Round of 16" — while the competition itself is in
      // Cnm. So Snm is the round only when it isn't just the competition name
      // repeated (which is the case for a domestic league, where Snm == the
      // league name). Lets the league page build a bracket and the standings
      // isolate the league phase.
      round:
        stage && stage.Snm && norm(stage.Snm) !== norm(stageDesc.name)
          ? stage.Snm
          : stage
            ? stage.CompST || null
            : null,
    },
    teams: { home: team(event.T1), away: team(event.T2) },
    goals: {
      home: started ? num(event.Tr1) : null,
      away: started ? num(event.Tr2) : null,
    },
    score: {
      halftime: {
        home: started ? num(event.Trh1) : null,
        away: started ? num(event.Trh2) : null,
      },
      fulltime: {
        home: finished ? num(event.Tr1) : null,
        away: finished ? num(event.Tr2) : null,
      },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

/**
 * Goal incidents from a scoreboard event.
 *
 * LiveScore packs incidents in `Incs-s`, a map keyed by half. Each incident has
 * a minute, player name, an incident-type code (`IT`) and a running score `Sc`.
 * Only goals are kept (IT 36/37/38-ish and the presence of a score jump); the
 * exact codes vary, so a change in `Sc` is the reliable "this was a goal" test.
 */
function events(scoreboardEvent) {
  const incs = scoreboardEvent['Incs-s'] || scoreboardEvent.Incs || {};
  const homeId = team(scoreboardEvent.T1).id;
  const out = [];

  // Incs-s is keyed by period; each value is a list of per-player incident
  // arrays. Flatten defensively across whatever nesting is present.
  const collect = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      // A leaf incident has Min + a name.
      if (node.length && typeof node[0] === 'object' && 'Min' in node[0]) {
        for (const inc of node) pushGoal(inc);
      } else {
        for (const child of node) collect(child);
      }
    } else if (typeof node === 'object') {
      if ('Min' in node) pushGoal(node);
      else for (const v of Object.values(node)) collect(v);
    }
  };

  const seen = new Set();
  function pushGoal(inc) {
    // A goal is an incident that carries a running score `Sc` (a 2-element
    // [home, away] array) and a player. Cards/subs have no Sc.
    const sc = inc.Sc;
    const isGoal = Array.isArray(sc) && sc.length === 2;
    if (!isGoal) return;

    const key = `${inc.Min}-${inc.Pn}-${sc.join(':')}`;
    if (seen.has(key)) return;
    seen.add(key);

    // `Nm` is which side scored (1 = home, 2 = away) in LiveScore's data.
    const isHome = inc.Nm === 1 || inc.Nm === '1';
    const it = Number(inc.IT);

    out.push({
      time: { elapsed: num(inc.Min), extra: null },
      team: {
        id: isHome ? homeId : team(scoreboardEvent.T2).id,
        name: null,
        logo: null,
      },
      player: {
        id: num(inc.Aid) ?? num(inc.ID),
        name: inc.Pn || inc.Ln || null,
      },
      assist: { id: null, name: null },
      type: 'Goal',
      // IT 37 is commonly an own goal, 38 a penalty; treat unknown as normal.
      detail: it === 37 ? 'Own Goal' : it === 38 ? 'Penalty' : 'Normal Goal',
      comments: null,
      isHome,
    });
  }

  collect(incs);
  out.sort((a, b) => (a.time.elapsed || 0) - (b.time.elapsed || 0));
  return out;
}

module.exports = {
  num,
  badge,
  mapStatus,
  liveMinute,
  fixture,
  events,
  resolveStage,
};
