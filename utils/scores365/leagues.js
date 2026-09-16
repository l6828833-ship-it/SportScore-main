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
  /**
   * Asian and African club cups.
   *
   * Both were unmapped, so they were served behind derived ids (623 -> 884619,
   * 624 -> 851047) with no Arabic name and no popularity rank — which for an
   * Arabic-language audience is backwards: these are the competitions Saudi,
   * Emirati, Qatari, Egyptian, Moroccan and Tunisian clubs actually play in.
   *
   * The 365scores ids are from the live `/competitions` catalogue: 623 is
   * "دوري أبطال آسيا للنخبة" and 624 is "دوري أبطال أفريقيا". The values are
   * API-Football's ids for the same competitions, kept consistent with the rest
   * of this table so a switch to SOURCE=apifootball needs no remapping.
   *
   * Links built while they were unmapped still resolve: `to365Id` inverts a
   * derived id by scanning the pinned ids, which now include these two.
   */
  [623, 17], // AFC Champions League Elite
  [624, 12], // CAF Champions League
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
  /**
   * Arab domestic cups, on LOCALLY ASSIGNED ids in the 900000+ range.
   *
   * Every other value in this table is API-Football's own id. These are not:
   * API-Football's id list is only published inside its dashboard, and guessing
   * from a league's neighbouring number is how you silently map a cup onto some
   * unrelated competition. So rather than invent plausible-looking ids, they get
   * explicit local ones, and the range says so at a glance.
   *
   * Safe by construction: API-Football's ids are all below ~1300 and this file's
   * derived ids occupy 800000-899999, so 900000+ can collide with neither.
   *
   * If SOURCE=apifootball is ever used, these nine need their real ids — nothing
   * else here does. Until then the id is just the handle the frontend pins, and a
   * competition with no handle cannot be curated at all: it stays on a derived id
   * that a cold process cannot even resolve back to a 365scores competition.
   *
   * 365scores ids from the live /competitions catalogue.
   */
  [5501, 900001], // كأس الملك (Saudi King's Cup)
  [553, 900002], //  كأس مصر (Egypt Cup)
  [5420, 900003], // كأس العرش (Moroccan Throne Cup)
  [6346, 900004], // كأس رئيس الدولة (UAE President's Cup)
  [6242, 900005], // كأس أمير قطر (Qatar Emir Cup)
  [5558, 900006], // كأس تونس (Tunisian Cup)
  [558, 900007], //  كأس الجزائر (Algerian Cup)
  [5635, 900008], // كأس الأردن (Jordan Cup)
  [7181, 900009], // كأس العراق (Iraq Cup)
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
