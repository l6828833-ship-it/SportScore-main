/**
 * 365scores competition mapping.
 *
 * 365scores identifies a competition by a single numeric `competitionId`.
 * Consumers of this server expect API-Football ids, so the popular competitions
 * are mapped both ways; anything unmapped gets a stable derived id so it still
 * groups and links consistently.
 *
 * Every id here was resolved from the live `/competitions` catalogue.
 */

/** 365scores competitionId -> API-Football id, for the pinned competitions. */
const TO_API_FOOTBALL = new Map([
  // International
  [5930, 1], // FIFA World Cup
  [167, 6], //  Africa Cup of Nations
  // European cups
  [572, 2], //  UEFA Champions League
  [573, 3], //  UEFA Europa League
  [7685, 848], // UEFA Conference League
  // South American cups
  [102, 13], //  CONMEBOL Libertadores
  [389, 11], //  CONMEBOL Sudamericana
  // Big five
  [7, 39], //   Premier League (England)
  [11, 140], // LaLiga (Spain)
  [17, 135], // Serie A (Italy)
  [25, 78], //  Bundesliga (Germany)
  [35, 61], //  Ligue 1 (France)
  // Domestic cups (each 365scores id verified against the live catalogue)
  [8, 45], //   FA Cup (England)
  [9, 48], //   EFL Cup / Carabao Cup (England)
  [13, 143], // Copa del Rey (Spain)
  [20, 137], // Coppa Italia (Italy)
  [28, 81], //  DFB-Pokal (Germany)
  [37, 66], //  Coupe de France (France)
  // Other widely-followed leagues
  [1, 40], //    Championship (England)
  [57, 88], //   Eredivisie (Netherlands)
  [73, 94], //   Liga Portugal (Primeira Liga)
  [61, 179], //  Scottish Premiership
  [98, 144], //  Jupiler Pro League (Belgium)
  [78, 203], //  Super Lig (Turkiye)
  [84, 197], //  Super League (Greece)
  [113, 71], //  Brasileirao Serie A (Brazil)
  [141, 262], // Liga MX (Mexico)
  [147, 98], //  J1 League (Japan)
  [618, 292], // K League 1 (South Korea)
  // Arab
  [649, 307], //  Saudi League
  [552, 233], //  Egyptian Premier League
  [557, 200], //  Botola Pro (Morocco)
  [549, 301], //  UAE Pro League
  [408, 305], //  Qatar Stars League (Doha Bank Stars League)
  [6822, 542], // Iraqi League
  [554, 202], //  Tunisia Division 1
  [560, 186], //  Ligue 1 (Algeria)
  [565, 387], //  Jordan Pro League
  // Rest
  [104, 253], // MLS
]);

/** Reverse: API-Football id -> 365scores competitionId. */
const TO_365 = new Map([...TO_API_FOOTBALL].map(([a, b]) => [b, a]));

/** The 365scores competition ids the catalogue/leagues route advertises. */
const KNOWN_365_IDS = [...TO_API_FOOTBALL.keys()];

/**
 * Stable 31-bit id (FNV-1a) for a competition 365scores tracks but we do not
 * pin, offset high so it can never collide with a real API-Football id.
 */
const UNMAPPED_BASE = 800000;
function stableId(value) {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 1 || 1;
}

function derivedIdFor(scores365Id) {
  return UNMAPPED_BASE + (stableId(String(scores365Id)) % 100000);
}

/**
 * Reverse index for DERIVED ids: derived exposed id -> 365scores competitionId.
 *
 * A derived id is a one-way hash, so it cannot be inverted arithmetically. But
 * every derived id this server ever emits is produced by `toExposedId` from a
 * real 365scores id it just saw in a payload — so recording the pair there lets
 * a later request for that derived id resolve back to the 365scores competition.
 *
 * Why this is needed: a competition can be requested by its derived id (a link
 * built from a fixtures list, a bookmark, a page cached before the competition
 * was pinned). Without the reverse lookup that request hit "not mapped" and the
 * league page rendered blank, even though the fixtures list had just shown it.
 */
const DERIVED_TO_365 = new Map();

/** 365scores competitionId -> the id this server exposes (API-Football or derived). */
function toExposedId(scores365Id) {
  const mapped = TO_API_FOOTBALL.get(Number(scores365Id));
  if (mapped) return mapped;
  const derived = derivedIdFor(scores365Id);
  // Remember the pairing so `to365Id` can invert this derived id later.
  DERIVED_TO_365.set(derived, Number(scores365Id));
  return derived;
}

/**
 * API-Football id (as the app requests) -> 365scores competitionId, or null.
 *
 * Three resolutions, in order:
 *   1. a pinned API-Football id (the common competitions);
 *   2. a derived id already seen this process, via the reverse index;
 *   3. a derived id NOT yet seen — recovered by testing the 365scores ids we
 *      know about, so a cold process can still resolve a bookmarked derived id
 *      for a pinned competition's neighbours without waiting to observe it.
 */
function to365Id(apiFootballId) {
  const id = Number(apiFootballId);
  const pinned = TO_365.get(id);
  if (pinned) return pinned;
  if (DERIVED_TO_365.has(id)) return DERIVED_TO_365.get(id);
  // Only derived-range ids can be inverted; a plain unknown id stays unmapped.
  //
  // Scan the pinned 365scores ids too, not just currently-unmapped ones: when a
  // competition gets newly PINNED (e.g. the EFL Cup, 9 -> 48), links built while
  // it was unmapped still carry its old derived id. Those must keep resolving to
  // the same 365scores competition, or every such bookmark 404s on the upgrade.
  if (id >= UNMAPPED_BASE) {
    for (const scores365Id of KNOWN_365_IDS) {
      if (derivedIdFor(scores365Id) === id) return scores365Id;
    }
  }
  return null;
}

/** Whether an exposed id maps to a real 365scores competition we can query. */
function isSupported(apiFootballId) {
  return TO_365.has(Number(apiFootballId));
}

module.exports = {
  TO_API_FOOTBALL,
  TO_365,
  KNOWN_365_IDS,
  toExposedId,
  to365Id,
  isSupported,
  stableId,
  UNMAPPED_BASE,
};
