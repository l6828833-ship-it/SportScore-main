/**
 * Competition catalogue for the scrape source, plus stable id derivation.
 *
 * BBC identifies things by slug and URN ("urn:bbc:sportsdata:football:team:
 * manchester-city") and exposes no numeric ids. Consumers of this server expect
 * numbers, so ids are DERIVED — see `stableId`.
 *
 * Where a competition is listed below it gets API-Football's id instead, so the
 * common competitions keep the same number they have on the other sources and a
 * consumer's league lookups (display names, ordering) keep working.
 */

/** BBC table slug -> API-Football id. Every slug verified to return a table. */
const LEAGUES = [
  {
    slug: 'premier-league',
    apiFootballId: 39,
    name: 'Premier League',
    country: 'England',
    labels: ['premier league', 'english premier league'],
  },
  {
    slug: 'spanish-la-liga',
    apiFootballId: 140,
    name: 'La Liga',
    country: 'Spain',
    labels: ['spanish la liga', 'la liga'],
  },
  {
    slug: 'italian-serie-a',
    apiFootballId: 135,
    name: 'Serie A',
    country: 'Italy',
    labels: ['italian serie a', 'serie a'],
  },
  {
    slug: 'german-bundesliga',
    apiFootballId: 78,
    name: 'Bundesliga',
    country: 'Germany',
    labels: ['german bundesliga', 'bundesliga'],
  },
  {
    slug: 'french-ligue-one',
    apiFootballId: 61,
    name: 'Ligue 1',
    country: 'France',
    labels: ['french ligue 1', 'french ligue one', 'ligue 1'],
  },
  {
    slug: 'champions-league',
    apiFootballId: 2,
    name: 'UEFA Champions League',
    country: 'World',
    labels: ['uefa champions league', 'champions league'],
  },
  {
    slug: 'europa-league',
    apiFootballId: 3,
    name: 'UEFA Europa League',
    country: 'World',
    labels: ['uefa europa league', 'europa league'],
  },
  {
    slug: 'europa-conference-league',
    apiFootballId: 848,
    name: 'UEFA Conference League',
    country: 'World',
    labels: ['uefa conference league', 'europa conference league'],
  },
  {
    slug: 'saudi-pro-league',
    apiFootballId: 307,
    name: 'Saudi Pro League',
    country: 'Saudi Arabia',
    labels: ['saudi pro league'],
  },
  {
    slug: 'scottish-premiership',
    apiFootballId: 179,
    name: 'Scottish Premiership',
    country: 'Scotland',
    labels: ['scottish premiership'],
  },
  {
    slug: 'championship',
    apiFootballId: 40,
    name: 'Championship',
    country: 'England',
    labels: ['championship'],
  },
  {
    slug: 'portuguese-primeira-liga',
    apiFootballId: 94,
    name: 'Primeira Liga',
    country: 'Portugal',
    labels: ['portuguese primeira liga'],
  },
  {
    slug: 'dutch-eredivisie',
    apiFootballId: 88,
    name: 'Eredivisie',
    country: 'Netherlands',
    labels: ['dutch eredivisie'],
  },
  {
    slug: 'turkish-super-lig',
    apiFootballId: 203,
    name: 'Super Lig',
    country: 'Turkey',
    labels: ['turkish super lig'],
  },
  {
    slug: 'league-one',
    apiFootballId: 41,
    name: 'League One',
    country: 'England',
    labels: ['league one'],
  },
  {
    slug: 'league-two',
    apiFootballId: 42,
    name: 'League Two',
    country: 'England',
    labels: ['league two'],
  },
  {
    slug: 'womens-super-league',
    apiFootballId: 44,
    name: "Women's Super League",
    country: 'England',
    labels: ["women's super league"],
  },

  // --- International tournaments BBC carries -------------------------------
  // BBC serves these at /world-cup/table and /africa-cup-of-nations/table, and
  // lists their fixtures during the tournament. They only appear on days they
  // play — there is no World Cup or AFCON match during the club season — but the
  // table and fixtures resolve whenever the competition is running.
  {
    slug: 'world-cup',
    apiFootballId: 1,
    name: 'FIFA World Cup',
    country: 'World',
    labels: ['fifa world cup', 'world cup'],
  },
  {
    slug: 'africa-cup-of-nations',
    apiFootballId: 6,
    name: 'Africa Cup of Nations',
    country: 'World',
    labels: ['africa cup of nations', 'afcon'],
  },
];

const BY_SLUG = new Map(LEAGUES.map((l) => [l.slug, l]));
const BY_API_ID = new Map(LEAGUES.map((l) => [l.apiFootballId, l]));

const LABEL_INDEX = new Map();
for (const league of LEAGUES) {
  for (const label of league.labels) LABEL_INDEX.set(label, league);
}

/**
 * Deterministic 31-bit id from a string (FNV-1a).
 *
 * BBC has no numeric ids, but consumers key on numbers — React list keys, URL
 * segments, cache keys. Hashing the URN gives an id that is stable across
 * requests and restarts because it is a pure function of the input, and the same
 * team hashes identically whether it appears in a fixture or a league table.
 *
 * These ids are NOT interchangeable with API-Football's or ESPN's. That is fine
 * as long as one source is active at a time, which is how this server works.
 *
 * Collisions are theoretically possible across a 2^31 space; with a few thousand
 * teams the probability is negligible, and the failure mode is two teams sharing
 * a link rather than corrupt data.
 */
function stableId(value) {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // FNV prime, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Force positive and away from 0.
  return hash >>> 1 || 1;
}

/**
 * Ids for competitions the catalogue does not name.
 *
 * BBC lists far more competitions than have a table slug here (the National
 * League Cup, regional qualifying rounds, and so on). They still need a
 * consistent id so fixtures group correctly, but it must not collide with a real
 * API-Football id — hence the high offset.
 */
const UNMAPPED_ID_BASE = 900000;

const normalizeLabel = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/**
 * Resolve a competition from a BBC display label ("UEFA Champions League",
 * "Saudi Pro League").
 *
 * EXACT match only — no substring fallback. That fallback was a real bug: BBC
 * labels England's top flight simply "Premier League", so a substring test made
 * "Ukrainian Premier League" (and any other country's) resolve to England, and
 * their goals leaked into England's scorer table. BBC uses full, unambiguous
 * labels, so every competition we care about is listed explicitly in `labels`
 * and anything unlisted gets its own derived id and its own name.
 */
function resolveLabel(label) {
  const key = normalizeLabel(label);
  const known = LABEL_INDEX.get(key);
  if (known) return known;

  return {
    slug: null,
    apiFootballId: UNMAPPED_ID_BASE + (stableId(key) % 90000),
    name: String(label || 'Unknown competition').trim(),
    country: null,
    labels: [key],
    unmapped: true,
  };
}

/** Resolve from a slug or an API-Football id, for standings and team lookups. */
function resolveLeague(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (BY_SLUG.has(text)) return BY_SLUG.get(text);
  const asNumber = Number(text);
  return Number.isFinite(asNumber) ? BY_API_ID.get(asNumber) || null : null;
}

module.exports = {
  LEAGUES,
  BY_SLUG,
  BY_API_ID,
  stableId,
  resolveLabel,
  resolveLeague,
  UNMAPPED_ID_BASE,
};
