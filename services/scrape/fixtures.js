/**
 * Fixtures scraped from BBC Sport. No API, no key.
 *
 * The big structural win over the other sources: one page load returns every
 * competition BBC covers for that date — 115 fixtures across 14 competitions in
 * a single request, versus one request per competition on ESPN.
 */

const client = require('../../utils/scrape/client');
const catalogue = require('../../utils/scrape/leagues');
const shape = require('../../utils/scrape/normalize');
const crests = require('../../utils/scrape/crests');

/** Today in UTC as YYYY-MM-DD. */
const todayKey = () => new Date().toISOString().slice(0, 10);

const shiftDate = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Anchored at noon so a DST shift cannot roll the date over.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
};

/**
 * Derived fixture id -> the date it was seen on.
 *
 * A match detail request carries only an id, but finding it means loading the
 * right day's page. This remembers where each fixture was seen, so opening a
 * match from a list is a direct hit; a cold start falls back to scanning a window
 * of dates.
 */
const dateIndex = new Map();
const INDEX_MAX = 20000;

function remember(id, dateKey) {
  if (dateIndex.size > INDEX_MAX) dateIndex.clear();
  dateIndex.set(String(id), dateKey);
}

/** Flatten BBC's competition -> stage -> events tree into fixtures. */
function flatten(payload, dateKey) {
  const fixtures = [];

  for (const group of payload.eventGroups || []) {
    const league = catalogue.resolveLabel(group.displayLabel);

    for (const stage of group.secondaryGroups || []) {
      for (const event of stage.events || []) {
        const fixture = shape.fixture(event, league, stage.displayLabel);
        // Remember the BBC slug so team crests can be resolved for this league.
        fixture.league.bbcSlug = league.slug || null;
        remember(fixture.fixture.id, dateKey);
        fixtures.push(fixture);
      }
    }
  }
  return fixtures;
}

/**
 * Fill in team crest URLs from ESPN, by name.
 *
 * BBC carries no crests, so this is a best-effort enrichment: the crest maps are
 * fetched once per competition and cached for a month, then every fixture in
 * that competition resolves for free. A name that does not match keeps a null
 * logo and the UI shows initials — never a broken image.
 */
async function addCrests(fixtures) {
  const slugs = new Set(fixtures.map((f) => f.league.bbcSlug).filter(Boolean));
  // Warm each mapped competition's team-list map once, in parallel.
  await Promise.all([...slugs].map((slug) => crests.preload(slug)));

  /**
   * Only enrich fixtures in a competition we can map. That leaves the long tail
   * of obscure qualifying-round ties alone, so a cold request does not fire
   * hundreds of name searches. Crests cache for a month, so subsequent loads are
   * almost all cache hits regardless. The concurrency cap protects that first
   * cold request.
   */
  const enrichable = fixtures.filter((f) =>
    crests.canResolve(f.league.bbcSlug)
  );
  const LIMIT = Number(process.env.CREST_CONCURRENCY) || 10;

  let cursor = 0;
  const worker = async () => {
    while (cursor < enrichable.length) {
      const f = enrichable[cursor++];
      const slug = f.league.bbcSlug;
      const [home, away] = await Promise.all([
        crests.crestFor(slug, f.teams.home.name),
        crests.crestFor(slug, f.teams.away.name),
      ]);
      if (home) f.teams.home.logo = home;
      if (away) f.teams.away.logo = away;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LIMIT, enrichable.length) }, worker)
  );
  return fixtures;
}

async function fixturesForDate(dateKey) {
  const payload = await client.scoresFixtures(dateKey);
  return flatten(payload, dateKey);
}

/** Status codes that mean the ball is in play right now. */
const IN_PLAY = new Set(['1H', '2H', 'HT', 'ET', 'PEN']);

/**
 * Mirrors API-Football's `/fixtures`. Supported: `date`, `live`, `league`,
 * `team`, `id`/`ids`. Anything else is ignored rather than silently answering
 * the wrong question.
 */
const getFixtures = async (params = {}) => {
  if (params.id || params.ids) {
    const one = await getFixtureById({ id: params.id || params.ids });
    return one && !one.error ? [one] : { error: 'Fixture not found' };
  }

  const live = String(params.live || '').toLowerCase();

  let fixtures;
  if (live) {
    /**
     * Scan yesterday AND today.
     *
     * A match kicking off at 22:00 UTC is still being played after midnight UTC,
     * but it belongs to the PREVIOUS day's page. Looking only at today's page
     * therefore reports "nothing live" every night for hours — which is exactly
     * what froze the match clock, because a consumer overlays this feed to keep
     * in-progress scores and minutes fresh.
     */
    const today = todayKey();
    const pages = await Promise.all(
      [shiftDate(today, -1), today].map((d) =>
        fixturesForDate(d).catch(() => [])
      )
    );
    fixtures = pages.flat().filter((f) => IN_PLAY.has(f.fixture.status.short));
  } else {
    // Deliberately not wrapped: a layout change or a network fault is a real
    // failure and must surface as one, not be flattened into "no matches today".
    fixtures = await fixturesForDate(String(params.date || todayKey()));
  }

  const league = catalogue.resolveLeague(params.league);
  if (league) {
    fixtures = fixtures.filter((f) => f.league.id === league.apiFootballId);
  }

  if (params.team) {
    const wanted = String(params.team);
    fixtures = fixtures.filter(
      (f) =>
        String(f.teams.home.id) === wanted || String(f.teams.away.id) === wanted
    );
  }

  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0)
  );

  if (fixtures.length === 0) {
    // Same sentinel the other sources use for a legitimately empty result.
    return { error: 'Empty data after multiple attempts' };
  }

  await addCrests(fixtures);
  return fixtures;
};

/**
 * How far either side of today to look when an unknown fixture id turns up.
 *
 * Each step is a page load, so the window is deliberately small. In practice the
 * index makes this unnecessary; it exists so a direct link to a match page still
 * resolves after a restart.
 */
const SEARCH_WINDOW_DAYS = Number(process.env.SCRAPE_SEARCH_WINDOW_DAYS) || 4;

/**
 * One fixture, with its goal and card events.
 *
 * BBC's fixture list already carries the event feed, so no second page load is
 * needed. Statistics and lineups are NOT available anywhere in this data.
 */
const getFixtureById = async (params = {}) => {
  const id = String(params.id || params.ids || params.fixture || '').trim();
  if (!id) return { error: 'An `id` query parameter is required' };

  const known = dateIndex.get(id);
  const candidates = known
    ? [known]
    : (() => {
        const today = todayKey();
        const dates = [today];
        for (let i = 1; i <= SEARCH_WINDOW_DAYS; i++) {
          // Recent results first: a match page is far more likely to be opened
          // for something just played than for something far ahead.
          dates.push(shiftDate(today, -i), shiftDate(today, i));
        }
        return dates;
      })();

  for (const dateKey of candidates) {
    let payload;
    try {
      payload = await client.scoresFixtures(dateKey, dateKey === todayKey());
    } catch {
      continue;
    }

    for (const group of payload.eventGroups || []) {
      const league = catalogue.resolveLabel(group.displayLabel);

      for (const stage of group.secondaryGroups || []) {
        for (const event of stage.events || []) {
          const base = shape.fixture(event, league, stage.displayLabel);
          if (String(base.fixture.id) !== id) continue;

          remember(base.fixture.id, dateKey);
          base.league.bbcSlug = league.slug || null;
          if (league.slug) {
            const [home, away] = await Promise.all([
              crests.crestFor(league.slug, base.teams.home.name),
              crests.crestFor(league.slug, base.teams.away.name),
            ]);
            if (home) base.teams.home.logo = home;
            if (away) base.teams.away.logo = away;
          }
          return {
            ...base,
            events: shape.events(event),
            // BBC's pages carry no team statistics or lineups. Empty arrays
            // rather than fabricated ones; a consumer hides those sections.
            statistics: [],
            lineups: [],
          };
        }
      }
    }
  }

  return { error: 'Fixture not found' };
};

const getRounds = async () => ({
  error: 'Rounds are not available from the scrape source',
});

/**
 * All fixtures for ONE competition across a window around today.
 *
 * BBC is date-based — there is no "season fixtures" page — so a competition's
 * recent results and upcoming matches are assembled by scanning a band of days
 * and keeping only that competition's events. The window is bounded and every
 * day is cached, so a league page costs a burst of cached page reads once, then
 * nothing.
 *
 * `?league=` accepts a slug or an API-Football id. `?past=` / `?future=`
 * override the window (in days).
 */
const LEAGUE_PAST_DAYS = Number(process.env.SCRAPE_LEAGUE_PAST_DAYS) || 21;
const LEAGUE_FUTURE_DAYS = Number(process.env.SCRAPE_LEAGUE_FUTURE_DAYS) || 21;
const LEAGUE_SCAN_CONCURRENCY =
  Number(process.env.SCRAPE_LEAGUE_CONCURRENCY) || 8;

const getLeagueFixtures = async (params = {}) => {
  const league = catalogue.resolveLeague(params.league);
  if (!league) {
    return {
      error: `Unknown competition "${params.league}". GET /leagues/getLeagues lists the supported ones.`,
    };
  }

  const past = Math.max(0, Number(params.past) || LEAGUE_PAST_DAYS);
  const future = Math.max(0, Number(params.future) || LEAGUE_FUTURE_DAYS);
  const today = todayKey();

  const dates = [];
  for (let i = past; i >= 1; i--) dates.push(shiftDate(today, -i));
  for (let i = 0; i <= future; i++) dates.push(shiftDate(today, i));

  // Bounded-concurrency scan; a failed day is skipped, not fatal.
  const collected = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < dates.length) {
      const dateKey = dates[cursor++];
      try {
        const dayFixtures = await fixturesForDate(dateKey);
        for (const f of dayFixtures) {
          if (f.league.id === league.apiFootballId) collected.push(f);
        }
      } catch {
        // skip a day that failed to load
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(LEAGUE_SCAN_CONCURRENCY, dates.length) },
      worker
    )
  );

  if (collected.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  // De-dupe (a fixture can appear on two adjacent days around midnight) and sort.
  const seen = new Set();
  const fixtures = collected.filter((f) => {
    if (seen.has(f.fixture.id)) return false;
    seen.add(f.fixture.id);
    return true;
  });
  fixtures.sort(
    (a, b) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0)
  );

  await addCrests(fixtures);

  return {
    league: {
      id: league.apiFootballId,
      name: league.name,
      country: league.country,
      type: /cup|champions|europa|conference|libertadores|world/i.test(
        league.name
      )
        ? 'Cup'
        : 'League',
      bbcSlug: league.slug || null,
    },
    fixtures,
    window: { past, future },
    updatedAt: Date.now(),
  };
};

module.exports = {
  getFixtures,
  getFixtureById,
  getRounds,
  getLeagueFixtures,
  fixturesForDate,
};
