/**
 * Upstream data source selector.
 *
 *   SOURCE=365scores    (default) 365scores' public JSON API. No key. Wide
 *                       coverage with a real live clock, standings, goal events
 *                       (scorer + assist) AND a FULL top-scorers / top-assists
 *                       leaderboard — the deepest free source wired in.
 *   SOURCE=livescore              LiveScore's public JSON API. No key. 200+
 *                       competitions in one request, but the scorer leaderboard
 *                       is only a 3-row preview and has no assists.
 *   SOURCE=scrape                 Scrapes BBC Sport web pages. No key, but only
 *                                 ~14 competitions.
 *   SOURCE=espn                   ESPN's public JSON endpoints. No key.
 *   SOURCE=apifootball            API-Football. Requires a key.
 *
 * All three emit the SAME response shapes — the scrape and ESPN services reshape
 * their payloads into API-Football's structure — so a consumer cannot tell them
 * apart and switching is one env line with no client work.
 *
 * Tradeoffs, honestly:
 *
 *   scrape       No API, no key, no account, no quota. Fixtures for a whole day
 *                across every competition BBC lists arrive in ONE request, with
 *                goal scorers, cards, half-time scores and a real match clock.
 *                Missing: team crests, venue, referee, match statistics and
 *                player search — BBC's pages simply do not carry them.
 *                Ids are derived by hashing BBC's identifiers, so they are
 *                stable but NOT the same numbers other sources use.
 *                Most fragile of the three: it depends on the shape of a JSON
 *                blob embedded in a web page, which can change without notice.
 *
 *   espn         No key either, and it does have crests, venues and match
 *                statistics. Costs one request PER competition for a date.
 *                No top-scorer leaderboards.
 *
 *   apifootball  The most complete and the only documented one, but needs a key
 *                and allows 100 requests/day on the free tier.
 */

const VALID = new Set([
  '365scores',
  'livescore',
  'scrape',
  'espn',
  'apifootball',
]);

const SOURCE = (() => {
  const raw = (process.env.SOURCE || '').trim().toLowerCase();
  return VALID.has(raw) ? raw : '365scores';
})();

const isScores365 = () => SOURCE === '365scores';
const isLiveScore = () => SOURCE === 'livescore';
const isScrape = () => SOURCE === 'scrape';
const isEspn = () => SOURCE === 'espn';
const isApiFootball = () => SOURCE === 'apifootball';

/**
 * Choose the implementation for the active source.
 *
 * Pass a map keyed by source name. A source with no entry falls back to the
 * scrape implementation, then ESPN, then API-Football — so adding a route to one
 * source at a time never leaves a controller holding `undefined`.
 */
const pick = (implementations) =>
  implementations[SOURCE] ||
  implementations['365scores'] ||
  implementations.livescore ||
  implementations.scrape ||
  implementations.espn ||
  implementations.apifootball;

module.exports = {
  SOURCE,
  isScores365,
  isLiveScore,
  isScrape,
  isEspn,
  isApiFootball,
  pick,
};
