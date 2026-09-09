/**
 * LiveScore competition mapping.
 *
 * LiveScore identifies a competition by a Stage (`Sid`) and a CompId, plus a
 * country (`Ccd`) and stage name (`Snm`). Consumers of this server expect
 * API-Football ids, so the popular competitions are mapped to those ids by
 * matching country + name; anything unmapped gets a stable derived id so it
 * still groups and links consistently.
 *
 * The point of using LiveScore is coverage, so this list only needs to name the
 * competitions that (a) the app pins for ordering, or (b) need the same id as
 * the other sources. Everything else flows through with a derived id and its
 * own LiveScore name.
 */

/**
 * Match key `country|name` (both lowercased) -> API-Football id.
 * LiveScore's own naming, verified against the live date feed.
 */
/**
 * Cups where LiveScore puts the competition in `Cnm` and the round in `Snm`
 * ("Champions League" / "League Stage"). These match on COUNTRY-NAME ALONE,
 * because the `Snm` phase changes through the season (League Stage -> Knockout
 * -> Final). Keyed by normalized `Cnm`.
 */
const CUP_BY_CNM = new Map([
  ['champions league', { id: 2, country: 'World' }],
  ['uefa champions league', { id: 2, country: 'World' }],
  ['europa league', { id: 3, country: 'World' }],
  ['uefa europa league', { id: 3, country: 'World' }],
  ['europa conference league', { id: 848, country: 'World' }],
  ['conference league', { id: 848, country: 'World' }],
  ['uefa conference league', { id: 848, country: 'World' }],
  ['world cup', { id: 1, country: 'World' }],
  ['fifa world cup', { id: 1, country: 'World' }],
  ['africa cup of nations', { id: 6, country: 'World' }],
]);

const MAP = [
  ['england|premier league', 39, 'England'],
  ['spain|laliga', 140, 'Spain'],
  ['italy|serie a', 135, 'Italy'],
  ['germany|bundesliga', 78, 'Germany'],
  ['france|ligue 1', 61, 'France'],
  ['europe|uefa champions league', 2, 'World'],
  ['europe|uefa europa league', 3, 'World'],
  ['europe|uefa europa conference league', 848, 'World'],
  ['europe|uefa conference league', 848, 'World'],
  ['saudi arabia|saudi professional league', 307, 'Saudi Arabia'],
  ['saudi arabia|saudi pro league', 307, 'Saudi Arabia'],
  ['scotland|premiership', 179, 'Scotland'],
  ['england|championship', 40, 'England'],
  ['portugal|primeira liga', 94, 'Portugal'],
  ['netherlands|eredivisie', 88, 'Netherlands'],
  ['turkiye|super lig', 203, 'Turkiye'],
  ['turkiye|süper lig', 203, 'Turkiye'],
  ['usa|mls', 253, 'USA'],
  ['usa|major league soccer', 253, 'USA'],
  ['brazil|serie a', 71, 'Brazil'],
  // Arab / African / international — the whole reason for switching sources.
  ['egypt|premier league', 233, 'Egypt'],
  ['united arab emirates|pro league', 301, 'United Arab Emirates'],
  ['united arab emirates|uae pro league', 301, 'United Arab Emirates'],
  ['qatar|stars league', 305, 'Qatar'],
  ['qatar|qatar stars league', 305, 'Qatar'],
  ['iraq|iraq stars league', 542, 'Iraq'],
  ['iraq|stars league', 542, 'Iraq'],
  ['morocco|botola pro', 200, 'Morocco'],
  ['tunisia|ligue professionnelle 1', 202, 'Tunisia'],
  ['algeria|ligue professionnelle 1', 186, 'Algeria'],
  ['jordan|pro league', 387, 'Jordan'],
  ['world|world cup', 1, 'World'],
  ['world|fifa world cup', 1, 'World'],
  ['africa|africa cup of nations', 6, 'World'],
];

const MAP_INDEX = new Map(
  MAP.map(([key, id, country]) => [key, { id, country }])
);

/**
 * API-Football id -> LiveScore URL slugs { country, competition }, for fetching
 * a competition's standings and scorers from its league page. Only the mapped
 * competitions need these; others have no table page here.
 */
const PAGE_SLUGS = {
  39: { country: 'england', competition: 'premier-league' },
  140: { country: 'spain', competition: 'laliga' },
  135: { country: 'italy', competition: 'serie-a' },
  78: { country: 'germany', competition: 'bundesliga' },
  61: { country: 'france', competition: 'ligue-1' },
  2: { country: 'europe', competition: 'champions-league' },
  3: { country: 'europe', competition: 'europa-league' },
  848: { country: 'europe', competition: 'conference-league' },
  307: { country: 'saudi-arabia', competition: 'saudi-professional-league' },
  179: { country: 'scotland', competition: 'premiership' },
  40: { country: 'england', competition: 'championship' },
  94: { country: 'portugal', competition: 'liga-portugal' },
  88: { country: 'netherlands', competition: 'eredivisie' },
  203: { country: 'turkiye', competition: 'super-lig' },
  253: { country: 'usa', competition: 'mls' },
  71: { country: 'brazil', competition: 'serie-a' },
  233: { country: 'egypt', competition: 'premier-league' },
  301: { country: 'united-arab-emirates', competition: 'uae-league' },
  305: { country: 'qatar', competition: 'qatar-stars-league' },
  542: { country: 'iraq', competition: 'iraq-stars-league' },
  200: { country: 'morocco', competition: 'botola-pro' },
  186: { country: 'algeria', competition: 'ligue-1' },
  1: { country: 'world', competition: 'world-cup' },
  6: { country: 'africa', competition: 'africa-cup-of-nations' },
};

function pageSlugFor(apiFootballId) {
  return PAGE_SLUGS[Number(apiFootballId)] || null;
}

const norm = (v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/**
 * Stable 31-bit id (FNV-1a) for anything not in the map, offset high so it can
 * never collide with a real API-Football id.
 */
const UNMAPPED_BASE = 800000;
function stableId(value) {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 1 || 1;
}

/**
 * Resolve a LiveScore Stage to a competition descriptor.
 * `{ id, name, country, unmapped }`.
 */
function resolveStage(stage) {
  const country = stage.Cnm || stage.Csnm || '';
  const name = stage.Snm || stage.CompN || '';

  // Cups: LiveScore uses Cnm for the competition ("Champions League") and Snm
  // for the round, so match on Cnm alone. Checked first so a phase name like
  // "League Stage" cannot send it down the unmapped path.
  const cup = CUP_BY_CNM.get(norm(country));
  if (cup) {
    return {
      id: cup.id,
      // Prefer the competition name over the round for display.
      name: country,
      country: cup.country,
      unmapped: false,
    };
  }

  const key = `${norm(country)}|${norm(name)}`;
  const known = MAP_INDEX.get(key);
  if (known) {
    return { id: known.id, name, country: known.country, unmapped: false };
  }
  return {
    id: UNMAPPED_BASE + (stableId(key) % 100000),
    name,
    country: country || null,
    unmapped: true,
  };
}

/** For a request by API-Football id: is this stage the wanted competition? */
function stageMatchesId(stage, apiFootballId) {
  return resolveStage(stage).id === Number(apiFootballId);
}

module.exports = {
  resolveStage,
  stageMatchesId,
  stableId,
  pageSlugFor,
  UNMAPPED_BASE,
};
