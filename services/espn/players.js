/**
 * Players from ESPN. No API key.
 *
 * Name search works via ESPN's public search endpoint. League scorer
 * leaderboards do NOT exist here — see `getTopScorers` for why that is reported
 * rather than faked.
 */

const client = require('../../utils/espn/client');

/**
 * Athlete id.
 *
 * There is no id field. `uid` looks like "s:600~a:173896" where the `a:` segment
 * is the athlete — that is the reliable source. The web link carries the same
 * number and is the fallback, because some results link to an app-only URL that
 * has no `/id/` path.
 */
function athleteId(item) {
  const uid = String(item.uid || '');
  const fromUid = /~a:(\d+)/.exec(uid);
  if (fromUid) return Number(fromUid[1]);

  const web = String((item.link && (item.link.web || item.link.href)) || '');
  const fromLink = /\/id\/(\d+)/.exec(web) || /~a:(\d+)/.exec(web);
  return fromLink ? Number(fromLink[1]) : null;
}

/** `image` is sometimes a string and sometimes `{default, defaultDark}`. */
function photo(item) {
  const img = item.image;
  if (!img) return null;
  if (typeof img === 'string') return img;
  return img.default || img.defaultDark || null;
}

/**
 * ESPN's search covers every sport it carries, so a query like "salah" returns
 * MMA fighters and basketball players alongside footballers. Each result states
 * its own `sport`, so anything that is not soccer is dropped — otherwise a
 * football app would list a Dallas Mavericks centre.
 */
function playersFrom(data) {
  const groups = (data && data.results) || [];
  const players = [];
  const seen = new Set();

  for (const group of groups) {
    if (String(group.type || '').toLowerCase() !== 'player') continue;

    for (const item of group.contents || []) {
      if (String(item.sport || '').toLowerCase() !== 'soccer') continue;

      const name = item.displayName || item.title || null;
      const id = athleteId(item);
      if (!name || id === null || seen.has(id)) continue;
      seen.add(id);

      players.push({
        id,
        name,
        firstname: null,
        lastname: null,
        photo: photo(item),
        // `subtitle` is the current club; `description` is the competition.
        team: item.subtitle || null,
        league: item.description || null,
      });
    }
  }
  return players;
}

const searchProfiles = async (params = {}) => {
  const search = String(params.search || params.name || params.q || '').trim();

  // ESPN copes with shorter queries than API-Football, but two characters match
  // most of the database and the result is noise.
  if (search.length < 3) {
    return {
      queryParams: { search },
      players: [],
      error: search
        ? 'Search requires at least 3 characters'
        : 'A `search` query parameter is required',
    };
  }

  let data;
  try {
    data = await client.searchPlayers(search);
  } catch {
    return { queryParams: { search }, players: [] };
  }

  return {
    queryParams: { search },
    players: playersFrom(data),
    paging: null,
    updatedAt: Date.now(),
  };
};

/**
 * Not available from ESPN.
 *
 * ESPN publishes no per-competition scoring leaderboard, and the athlete
 * statistics endpoint returns an empty set for soccer. It could be approximated
 * by replaying goal events across a whole season, but that would rank only the
 * matches that happen to be cached and present the result as the league's
 * leading scorers — inventing a standing rather than reporting one.
 *
 * The 501 is deliberate: it lets a consumer distinguish "this source has no
 * leaderboard" from "nobody has scored yet", which an empty list cannot express.
 */
const notSupported = (what) => async () => {
  const error = new Error(
    `${what} are not available from the ESPN source. Set SOURCE=apifootball with an API-Football key to enable them.`
  );
  error.status = 501;
  throw error;
};

module.exports = {
  searchProfiles,
  getPlayers: searchProfiles,
  getTopScorers: notSupported('Top scorers'),
  getAssists: notSupported('Top assists'),
  getSquads: notSupported('Squads'),
  getPlayerSeasons: notSupported('Player seasons'),
};
