/**
 * Competition catalogue for the ESPN source.
 *
 * ESPN addresses competitions by slug ("eng.1") and has its own numeric ids,
 * but this server's responses are consumed as API-Football shapes — so each
 * entry also carries `apiFootballId`, and that is the id emitted downstream.
 * Keeping the ids in API-Football's namespace means a consumer's league lookups
 * (display names, popularity ordering, standings links) work identically
 * whichever source is active.
 *
 * Every slug below was verified to return HTTP 200 from
 * `site.api.espn.com/apis/site/v2/sports/soccer/<slug>/scoreboard`.
 *
 * Known gaps: ESPN has no Egyptian, Emirati, Qatari, Iraqi, Moroccan or
 * Tunisian domestic league. The Saudi Pro League IS covered, as are the AFC
 * Champions League and AFC World Cup qualifying.
 */

const LEAGUES = [
  // --- Top European leagues -------------------------------------------------
  {
    slug: 'eng.1',
    apiFootballId: 39,
    name: 'Premier League',
    country: 'England',
  },
  { slug: 'esp.1', apiFootballId: 140, name: 'La Liga', country: 'Spain' },
  { slug: 'ita.1', apiFootballId: 135, name: 'Serie A', country: 'Italy' },
  { slug: 'ger.1', apiFootballId: 78, name: 'Bundesliga', country: 'Germany' },
  { slug: 'fra.1', apiFootballId: 61, name: 'Ligue 1', country: 'France' },

  // --- UEFA club competitions ----------------------------------------------
  {
    slug: 'uefa.champions',
    apiFootballId: 2,
    name: 'UEFA Champions League',
    country: 'World',
  },
  {
    slug: 'uefa.europa',
    apiFootballId: 3,
    name: 'UEFA Europa League',
    country: 'World',
  },
  {
    slug: 'uefa.europa.conf',
    apiFootballId: 848,
    name: 'UEFA Conference League',
    country: 'World',
  },
  {
    slug: 'uefa.super_cup',
    apiFootballId: 531,
    name: 'UEFA Super Cup',
    country: 'World',
  },

  // --- Middle East / Asia ---------------------------------------------------
  {
    slug: 'ksa.1',
    apiFootballId: 307,
    name: 'Saudi Pro League',
    country: 'Saudi Arabia',
  },
  {
    slug: 'afc.champions',
    apiFootballId: 17,
    name: 'AFC Champions League',
    country: 'World',
  },
  { slug: 'jpn.1', apiFootballId: 98, name: 'J1 League', country: 'Japan' },
  {
    slug: 'chn.1',
    apiFootballId: 169,
    name: 'Chinese Super League',
    country: 'China',
  },
  {
    slug: 'ind.1',
    apiFootballId: 323,
    name: 'Indian Super League',
    country: 'India',
  },

  // --- Americas -------------------------------------------------------------
  {
    slug: 'usa.1',
    apiFootballId: 253,
    name: 'Major League Soccer',
    country: 'United States',
  },
  { slug: 'mex.1', apiFootballId: 262, name: 'Liga MX', country: 'Mexico' },
  {
    slug: 'bra.1',
    apiFootballId: 71,
    name: 'Brasileirao Serie A',
    country: 'Brazil',
  },
  {
    slug: 'arg.1',
    apiFootballId: 128,
    name: 'Liga Profesional Argentina',
    country: 'Argentina',
  },
  { slug: 'col.1', apiFootballId: 239, name: 'Primera A', country: 'Colombia' },
  {
    slug: 'chi.1',
    apiFootballId: 265,
    name: 'Primera Division',
    country: 'Chile',
  },
  {
    slug: 'conmebol.libertadores',
    apiFootballId: 13,
    name: 'CONMEBOL Libertadores',
    country: 'World',
  },
  {
    slug: 'concacaf.champions_cup',
    apiFootballId: 16,
    name: 'CONCACAF Champions Cup',
    country: 'World',
  },

  // --- Other European leagues ----------------------------------------------
  {
    slug: 'ned.1',
    apiFootballId: 88,
    name: 'Eredivisie',
    country: 'Netherlands',
  },
  {
    slug: 'por.1',
    apiFootballId: 94,
    name: 'Primeira Liga',
    country: 'Portugal',
  },
  { slug: 'tur.1', apiFootballId: 203, name: 'Super Lig', country: 'Turkey' },
  {
    slug: 'bel.1',
    apiFootballId: 144,
    name: 'Jupiler Pro League',
    country: 'Belgium',
  },
  {
    slug: 'sco.1',
    apiFootballId: 179,
    name: 'Scottish Premiership',
    country: 'Scotland',
  },
  {
    slug: 'aut.1',
    apiFootballId: 218,
    name: 'Austrian Bundesliga',
    country: 'Austria',
  },
  {
    slug: 'sui.1',
    apiFootballId: 207,
    name: 'Swiss Super League',
    country: 'Switzerland',
  },
  {
    slug: 'gre.1',
    apiFootballId: 197,
    name: 'Super League Greece',
    country: 'Greece',
  },
  {
    slug: 'den.1',
    apiFootballId: 119,
    name: 'Danish Superliga',
    country: 'Denmark',
  },
  { slug: 'nor.1', apiFootballId: 103, name: 'Eliteserien', country: 'Norway' },
  { slug: 'swe.1', apiFootballId: 113, name: 'Allsvenskan', country: 'Sweden' },
  {
    slug: 'rus.1',
    apiFootballId: 235,
    name: 'Russian Premier League',
    country: 'Russia',
  },
  {
    slug: 'eng.2',
    apiFootballId: 40,
    name: 'Championship',
    country: 'England',
  },

  // --- Domestic cups --------------------------------------------------------
  { slug: 'eng.fa', apiFootballId: 45, name: 'FA Cup', country: 'England' },
  {
    slug: 'eng.league_cup',
    apiFootballId: 48,
    name: 'Carabao Cup',
    country: 'England',
  },
  {
    slug: 'esp.copa_del_rey',
    apiFootballId: 143,
    name: 'Copa del Rey',
    country: 'Spain',
  },
  {
    slug: 'ita.coppa_italia',
    apiFootballId: 137,
    name: 'Coppa Italia',
    country: 'Italy',
  },
  {
    slug: 'ger.dfb_pokal',
    apiFootballId: 81,
    name: 'DFB Pokal',
    country: 'Germany',
  },
  {
    slug: 'fra.coupe_de_france',
    apiFootballId: 66,
    name: 'Coupe de France',
    country: 'France',
  },

  // --- Africa ---------------------------------------------------------------
  {
    slug: 'caf.champions',
    apiFootballId: 12,
    name: 'CAF Champions League',
    country: 'World',
  },
  {
    slug: 'rsa.1',
    apiFootballId: 288,
    name: 'South African Premiership',
    country: 'South Africa',
  },

  // --- International --------------------------------------------------------
  {
    slug: 'fifa.world',
    apiFootballId: 1,
    name: 'FIFA World Cup',
    country: 'World',
  },
  {
    slug: 'fifa.worldq.afc',
    apiFootballId: 29,
    name: 'World Cup Qualifying AFC',
    country: 'World',
  },
  {
    slug: 'fifa.cwc',
    apiFootballId: 15,
    name: 'FIFA Club World Cup',
    country: 'World',
  },
  {
    slug: 'uefa.nations',
    apiFootballId: 5,
    name: 'UEFA Nations League',
    country: 'World',
  },
  {
    slug: 'club.friendly',
    apiFootballId: 667,
    name: 'Club Friendlies',
    country: 'World',
  },
];

const BY_SLUG = new Map(LEAGUES.map((l) => [l.slug, l]));
const BY_API_ID = new Map(LEAGUES.map((l) => [l.apiFootballId, l]));

/**
 * Competitions scanned when listing fixtures for a date.
 *
 * ESPN's scoreboard is per competition, so "everything on this date" means one
 * request per entry. That is affordable because ESPN needs no key and imposes
 * no quota — but it is still latency, so the default set is the widely-followed
 * competitions rather than all of them.
 *
 *   ESPN_LEAGUES=all              scan every entry above
 *   ESPN_LEAGUES=eng.1,esp.1,...  scan exactly these slugs
 */
const DEFAULT_SCAN = [
  'eng.1',
  'esp.1',
  'ita.1',
  'ger.1',
  'fra.1',
  'uefa.champions',
  'uefa.europa',
  'uefa.europa.conf',
  'ksa.1',
  'afc.champions',
  'usa.1',
  'mex.1',
  'bra.1',
  'arg.1',
  'ned.1',
  'por.1',
  'tur.1',
  'bel.1',
  'sco.1',
  'eng.2',
  'eng.fa',
  'eng.league_cup',
  'esp.copa_del_rey',
  'ita.coppa_italia',
  'ger.dfb_pokal',
  'fra.coupe_de_france',
  'fifa.world',
  'fifa.worldq.afc',
  'uefa.nations',
  'caf.champions',
];

const scanLeagues = () => {
  const raw = (process.env.ESPN_LEAGUES || '').trim();
  if (!raw) return DEFAULT_SCAN.map((s) => BY_SLUG.get(s)).filter(Boolean);
  if (raw.toLowerCase() === 'all') return LEAGUES;

  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => BY_SLUG.get(s))
    .filter(Boolean);
  return wanted.length > 0
    ? wanted
    : DEFAULT_SCAN.map((s) => BY_SLUG.get(s)).filter(Boolean);
};

/** Resolve a league reference that may be a slug or an API-Football id. */
const resolveLeague = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const asString = String(value).trim();
  if (BY_SLUG.has(asString)) return BY_SLUG.get(asString);
  const asNumber = Number(asString);
  return Number.isFinite(asNumber) ? BY_API_ID.get(asNumber) || null : null;
};

module.exports = { LEAGUES, BY_SLUG, BY_API_ID, scanLeagues, resolveLeague };
