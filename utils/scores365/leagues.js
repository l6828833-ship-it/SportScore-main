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
  // English domestic cups
  [8, 45], //   FA Cup
  [9, 48], //   EFL Cup (Carabao Cup)
  // Big five
  [7, 39], //   Premier League (England)
  [11, 140], // LaLiga (Spain)
  [17, 135], // Serie A (Italy)
  [25, 78], //  Bundesliga (Germany)
  [35, 61], //  Ligue 1 (France)
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

/** 365scores competitionId -> the id this server exposes (API-Football or derived). */
function toExposedId(scores365Id) {
  const mapped = TO_API_FOOTBALL.get(Number(scores365Id));
  if (mapped) return mapped;
  return UNMAPPED_BASE + (stableId(String(scores365Id)) % 100000);
}

/** API-Football id (as the app requests) -> 365scores competitionId, or null. */
function to365Id(apiFootballId) {
  return TO_365.get(Number(apiFootballId)) || null;
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
