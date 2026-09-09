/**
 * Team crests for the scrape source.
 *
 * BBC's pages carry team NAMES but no crest URLs, and the user wants logos shown.
 * ESPN serves a reliable, keyless crest for any team by its numeric id
 * (`https://a.espncdn.com/i/teamlogos/soccer/500/<id>.png`), and ESPN also has a
 * per-competition team list. So the crest is resolved by NAME:
 *
 *   1. once per competition, fetch ESPN's team list and build
 *      normalized-name -> ESPN crest URL
 *   2. look a BBC team name up in that map
 *
 * The maps are cached for a month (crest URLs never change), so this costs one
 * ESPN request per competition per month and nothing thereafter. A name that
 * does not resolve simply gets no crest, and the UI falls back to initials.
 */

const axios = require('axios');
const cache = require('./../cache');

const TTL = Number(process.env.CREST_TTL_SECONDS) || 30 * 24 * 60 * 60;
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 15000;

/**
 * A NON-browser User-Agent, on purpose.
 *
 * ESPN's site.api behaves the opposite of most anti-bot setups: it answers a
 * plain client like `curl` with 200 but returns 403 to a browser-like UA on the
 * `/teams` endpoint. Sending the scrape module's browser UA here is exactly what
 * made every crest come back empty. The crest IMAGES on a.espncdn.com serve to
 * anyone, so only this JSON lookup is sensitive to the header.
 */
const TEAMS_USER_AGENT = process.env.CREST_USER_AGENT || 'curl/8.4';

const CREST = (id) => `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;

/**
 * BBC slug -> ESPN slug, for the competitions whose crests we can resolve.
 * A competition not listed here just yields no crests (initials shown).
 */
const ESPN_SLUG = {
  'premier-league': 'eng.1',
  'spanish-la-liga': 'esp.1',
  'italian-serie-a': 'ita.1',
  'german-bundesliga': 'ger.1',
  'french-ligue-one': 'fra.1',
  'champions-league': 'uefa.champions',
  'europa-league': 'uefa.europa',
  'europa-conference-league': 'uefa.europa.conf',
  'saudi-pro-league': 'ksa.1',
  'scottish-premiership': 'sco.1',
  championship: 'eng.2',
  'portuguese-primeira-liga': 'por.1',
  'dutch-eredivisie': 'ned.1',
  'turkish-super-lig': 'tur.1',
};

/**
 * Normalize a team name for matching across two providers that spell them
 * differently ("Man City" vs "Manchester City", "Wolves" vs "Wolverhampton").
 * Drops common club-type noise and diacritics so more names line up.
 */
function normalize(name) {
  return (
    String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // ø/ł/ð and similar letters survive NFD, so fold the common ones.
      .replace(/ø/g, 'o')
      .replace(/ł/g, 'l')
      .replace(/ð/g, 'd')
      .replace(/æ/g, 'ae')
      .replace(/\b(fc|afc|cf|sc|ac|as|ss|us|rc|cd|ud|club|de|the)\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Short aliases BBC uses that would otherwise not match ESPN's full names. */
function aliases(name) {
  const n = normalize(name);
  const out = new Set([n]);
  // e.g. "manchester city" -> also index "man city"
  out.add(n.replace(/\bmanchester\b/, 'man'));
  out.add(n.replace(/\bwolverhampton\b/, 'wolves'));
  out.add(n.replace(/\bwanderers\b/, ''));
  out.add(n.replace(/\butd\b/, 'united'));
  out.add(n.replace(/\bunited\b/, 'utd'));
  // First significant word ("Brighton & Hove Albion" -> "brighton")
  const first = n.split(' ')[0];
  if (first && first.length >= 4) out.add(first);
  return [...out].filter(Boolean);
}

async function fetchEspnTeams(espnSlug) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnSlug}/teams`;
  const { data } = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': TEAMS_USER_AGENT, Accept: 'application/json' },
  });
  const list =
    (data.sports &&
      data.sports[0].leagues &&
      data.sports[0].leagues[0].teams) ||
    [];
  return list.map((e) => e.team).filter(Boolean);
}

/** normalized-name -> crest URL for one BBC competition. Cached hard. */
async function mapForLeague(bbcSlug) {
  const espnSlug = ESPN_SLUG[bbcSlug];
  if (!espnSlug) return {};

  const key = `crestmap:${espnSlug}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let map = {};
  try {
    const teams = await fetchEspnTeams(espnSlug);
    for (const team of teams) {
      const url =
        team.id != null
          ? CREST(team.id)
          : (team.logos && team.logos[0] && team.logos[0].href) || null;
      if (!url) continue;
      for (const name of [
        team.displayName,
        team.shortDisplayName,
        team.name,
        team.nickname,
      ]) {
        if (!name) continue;
        for (const alias of aliases(name)) map[alias] = url;
      }
    }
  } catch (error) {
    // Crests are a nice-to-have; a failure must never break fixtures.
    console.error(`[crests] ${espnSlug}: ${error.message}`);
    map = {};
  }

  cache.set(key, map, TTL);
  return map;
}

/**
 * Fallback: resolve a crest by searching ESPN for the club by name.
 *
 * Needed for competitions whose `/teams` list is unavailable or incomplete —
 * most importantly the Champions/Europa/Conference League, where ESPN's team
 * list omits every club that came through qualifying (Sabah, AEK, Bodø/Glimt…),
 * which is why those rows showed initials. ESPN's search DOES know them, and the
 * crest URL is derivable from the team id in the result's `uid`
 * ("s:600~t:20298") even when the result carries no image field.
 *
 * Each distinct name is looked up once and cached (hit or miss) for a month, so
 * a page of fixtures never repeats a search and an unknown name is not retried.
 */
async function crestBySearch(teamName) {
  const key = `crestsearch:${normalize(teamName)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let url = null;
  try {
    const { data } = await axios.get(
      'https://site.web.api.espn.com/apis/search/v2',
      {
        params: { query: teamName, limit: 8, sport: 'soccer' },
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': TEAMS_USER_AGENT, Accept: 'application/json' },
      }
    );

    const wanted = normalize(teamName);
    for (const group of data.results || []) {
      if (String(group.type || '').toLowerCase() !== 'team') continue;
      for (const item of group.contents || []) {
        if (String(item.sport || '').toLowerCase() !== 'soccer') continue;
        // Guard against a loose match returning the wrong club: the result name
        // must share the significant part of the query.
        const name = normalize(item.displayName || item.title || '');
        const overlap =
          name === wanted ||
          name.includes(wanted) ||
          wanted.includes(name) ||
          name.split(' ')[0] === wanted.split(' ')[0];
        if (!overlap) continue;

        const image = item.image && (item.image.default || item.image);
        if (typeof image === 'string' && image) {
          url = image;
        } else {
          const m = /~t:(\d+)/.exec(String(item.uid || ''));
          if (m) url = CREST(m[1]);
        }
        if (url) break;
      }
      if (url) break;
    }
  } catch {
    url = null;
  }

  // Cache the miss too (as null) so a name ESPN doesn't know isn't re-searched.
  cache.set(key, url, TTL);
  return url;
}

/**
 * Resolve a crest URL for a team name within a competition.
 *
 * First the competition's team-list map (one request per competition, cached a
 * month); then, for anything unmatched, an ESPN name search. Returns null only
 * when both miss, and the caller leaves `logo` null so the UI shows initials.
 */
async function crestFor(bbcSlug, teamName) {
  if (!teamName) return null;

  if (bbcSlug) {
    const map = await mapForLeague(bbcSlug);
    for (const alias of aliases(teamName)) {
      if (map[alias]) return map[alias];
    }
  }

  // Cup competitions (Champions League etc.) either have no team list or omit
  // qualifiers, so the search fallback is what fills those crests in.
  return crestBySearch(teamName);
}

/** Warm the map once so a page of fixtures resolves crests without N calls. */
async function preload(bbcSlug) {
  if (ESPN_SLUG[bbcSlug]) await mapForLeague(bbcSlug);
}

/**
 * Whether crests should be attempted for a competition.
 *
 * True for a mapped league (has an ESPN team list) OR for the UEFA cups, where
 * there is no usable team list but the per-name search fallback still resolves
 * most clubs. Everything else (regional qualifiers, minor cups) is skipped so a
 * cold request stays fast.
 */
const CUP_SLUGS = new Set([
  'champions-league',
  'europa-league',
  'europa-conference-league',
]);
function canResolve(bbcSlug) {
  return (
    Boolean(bbcSlug) && (Boolean(ESPN_SLUG[bbcSlug]) || CUP_SLUGS.has(bbcSlug))
  );
}

module.exports = { crestFor, preload, canResolve, ESPN_SLUG };
