/**
 * Search for the 365scores source: every football team and competition the
 * source tracks, not only the ones this server pins.
 *
 * 365scores' own search does the matching, and does it across languages —
 * "real" finds "ريال مدريد" and "ريال" finds "Real Madrid" — so a reader can
 * type in whichever script they think of the name in. The names come back in
 * the consumer's `lang`.
 *
 * Ids are the ones every other route uses: a competition's exposed id (the
 * API-Football one when pinned, else the stable derived one), and the
 * 365scores id for a team, which is what fixtures and tables already carry.
 * A team comes with its main competition, which is where a team page is built
 * from; one without a main competition is left out, since there would be
 * nothing to open.
 */
const client = require('../../utils/scores365/client');
const nz = require('../../utils/scores365/normalize');
const { toExposedId } = require('../../utils/scores365/leagues');

const FOOTBALL = 1;
const MAX_COMPETITIONS = 15;
const MAX_TEAMS = 25;

const byPopularity = (a, b) =>
  (b.popularityRank || 0) - (a.popularityRank || 0);

/** No football team or competition in a search answer. */
const isEmpty = (body) =>
  ![...(body.competitions || []), ...(body.competitors || [])].some(
    (entry) => entry.sportId === FOOTBALL,
  );

const search = async (params = {}) => {
  const query = String(params.q || params.query || '').trim();
  if (query.length < 2) {
    return { query, competitions: [], teams: [] };
  }

  const langId = client.resolveLangId(params.lang || params.langId);
  const ask = (text) =>
    client.search(text, { timezoneName: params.timezoneName, langId });
  let body;
  try {
    // One retry: the source drops the odd request, and a search that fails
    // once reads to the reader as "nothing by that name".
    body = await ask(query).catch(() => ask(query));
    /**
     * Arabic names carry the article: people type "الهلال". The source's
     * Arabic index finds that, but its other languages' indexes only match the
     * bare word ("هلال" finds "Al Hilal Riyadh" in English). So an Arabic query
     * that found nothing is tried again without the article.
     */
    const bare = query.replace(/(^|\s)ال(?=\S)/g, '$1');
    if (isEmpty(body) && bare !== query && bare.length >= 2) {
      body = await ask(bare);
    }
  } catch {
    return { error: 'Search is unavailable right now' };
  }

  const countries = new Map(
    (body.countries || []).map((country) => [country.id, country.name || null]),
  );

  const competitions = (body.competitions || [])
    .filter((c) => c.sportId === FOOTBALL && c.hideOnSearch !== true)
    .sort(byPopularity)
    .slice(0, MAX_COMPETITIONS)
    .map((c) => ({
      id: toExposedId(c.id),
      name: c.name || null,
      country: countries.get(c.countryId) || null,
      logo: nz.competitionLogo(c.id),
      hasTable: c.hasStandings === true,
    }));

  const teams = (body.competitors || [])
    .filter((t) => t.sportId === FOOTBALL && Number(t.mainCompetitionId) > 0)
    .sort(byPopularity)
    .slice(0, MAX_TEAMS)
    .map((t) => ({
      id: nz.num(t.id),
      name: t.name || null,
      country: countries.get(t.countryId) || null,
      logo: nz.competitorLogo(t.id),
      // Where the team's page is built from: its own league, usually.
      leagueId: toExposedId(t.mainCompetitionId),
      // A national team plays for a country, not in one.
      national: t.type === 2,
    }));

  return { query, competitions, teams };
};

module.exports = { search };
