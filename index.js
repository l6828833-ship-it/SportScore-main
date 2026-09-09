const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initDb, dbReady } = require('./utils/db');
const {
  apiUrl,
  apiProvider,
  hasApiKey,
  defaultSeason,
} = require('./utils/constants');
const { allowedLeagueIds } = require('./utils/leagueFilter');
const fetchData = require('./utils/fetchData');
const source = require('./utils/source');
const { LEAGUES: ESPN_LEAGUES, scanLeagues } = require('./utils/espn/leagues');
const { LEAGUES: SCRAPE_LEAGUES } = require('./utils/scrape/leagues');

const app = express();

/**
 * CORS.
 *
 * `cors()` with no options is `Access-Control-Allow-Origin: *`, which is fine
 * for a backend on your own machine but not for one exposed publicly. Set
 * `CORS_ORIGIN` to lock it to your app's origin (comma-separated for several).
 */
const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
app.use(
  cors(
    corsOrigin
      ? {
          origin: corsOrigin
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean),
        }
      : undefined
  )
);

// Required for POST /news — without it req.body is undefined and the handler
// throws on property access.
app.use(express.json());

// Import your routes
const leaguesRoutes = require('./routes/leagues');
const teamsRoutes = require('./routes/teams');
const venuesRoutes = require('./routes/venues');
const standingsRoutes = require('./routes/standings');
const fixturesRoutes = require('./routes/fixtures');
const playersRoutes = require('./routes/players');
const predictionsRoutes = require('./routes/predictions');
const newsRoutes = require('./routes/news');

// Connect to the database if one is configured. Optional by design.
initDb();

// Set up routes
app.use('/leagues', leaguesRoutes);
app.use('/teams', teamsRoutes);
app.use('/venues', venuesRoutes);
app.use('/standings', standingsRoutes);
app.use('/fixtures', fixturesRoutes);
app.use('/players', playersRoutes);
app.use('/predictions', predictionsRoutes);
app.use('/news', newsRoutes);

/**
 * Readiness probe. Consumers use this to tell "backend is down" apart from
 * "backend is up but misconfigured", which are very different problems and
 * otherwise both surface as failed data requests.
 */
function upstreamInfo() {
  if (source.isScores365()) {
    return {
      provider: '365scores',
      method: 'public JSON API (365scores)',
      baseUrl:
        process.env.SCORES365_BASE_URL || 'https://webws.365scores.com/web',
      keyRequired: false,
      note: 'wide coverage incl. Arab leagues and World Cup, with a live clock, standings, goal events (scorer + assist) and a FULL top-scorers/top-assists leaderboard',
      // 365scores' public feed serves the current season's table only.
      historicalSeasons: false,
      notProvided: [
        'referee',
        'aggregated match statistics',
        'player search',
        'past seasons',
      ],
    };
  }
  if (source.isLiveScore()) {
    return {
      provider: 'livescore',
      method: 'public JSON API (LiveScore)',
      baseUrl:
        process.env.LIVESCORE_BASE_URL ||
        'https://prod-public-api.livescore.com/v1/api/app',
      keyRequired: false,
      // One date request lists every competition playing that day.
      note: '200+ competitions incl. Arab leagues, CAF and World Cup',
      historicalSeasons: false,
      notProvided: [
        'venue',
        'referee',
        'match statistics',
        'player search',
        'past seasons',
      ],
    };
  }
  if (source.isScrape()) {
    return {
      provider: 'scrape',
      method: 'HTML scraping (BBC Sport)',
      baseUrl:
        process.env.SCRAPE_BASE_URL || 'https://www.bbc.com/sport/football',
      keyRequired: false,
      tablesAvailable: SCRAPE_LEAGUES.length,
      // BBC serves only the current season's table (it ignores a season param),
      // so a consumer must not offer a season picker on this source.
      historicalSeasons: false,
      // Set expectations up front rather than letting a consumer discover
      // these by getting nulls.
      notProvided: [
        'crests',
        'venue',
        'referee',
        'match statistics',
        'player search',
        'past seasons',
      ],
    };
  }
  if (source.isEspn()) {
    return {
      provider: 'espn',
      method: 'public JSON endpoints',
      baseUrl: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
      keyRequired: false,
      competitions: scanLeagues().length,
      competitionsAvailable: ESPN_LEAGUES.length,
      // ESPN's scoreboards/standings are current-season on the free endpoints.
      historicalSeasons: false,
      notProvided: ['top scorers', 'past seasons'],
    };
  }
  return {
    provider: apiProvider,
    method: 'API-Football',
    baseUrl: apiUrl,
    keyRequired: true,
    keyConfigured: hasApiKey(),
    // API-Football carries historical tables, so the season picker is real.
    historicalSeasons: true,
  };
}

app.get('/health', (_, res) => {
  res.json({
    ok: true,
    service: 'sportscore',
    source: source.SOURCE,
    // The question a consumer actually cares about: can this server return
    // football data right now? Only API-Football can answer no.
    ready: !source.isApiFootball() || hasApiKey(),
    upstream: upstreamInfo(),
    database: { configured: Boolean(process.env.DB), connected: dbReady() },
    leagueFilter:
      source.isApiFootball() && allowedLeagueIds ? [...allowedLeagueIds] : null,
    defaultSeason,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** Last quota figures the upstream reported, so budget state is observable. */
app.get('/quota', (_, res) => res.json(fetchData.quota));

// Home route
app.get('/', (_, res) => {
  res.send(
    'SportScore back-end server, view manual for a list of all endpoints'
  );
});

app.use((req, res) => {
  res
    .status(404)
    .json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);

  if (source.isScores365()) {
    console.log(
      '[server] source: 365scores — no key. 365scores public JSON API.'
    );
    console.log(
      '[server] wide coverage, live clock, standings, goal events + a FULL scorers/assists leaderboard'
    );
  } else if (source.isLiveScore()) {
    console.log(
      '[server] source: livescore — no key. LiveScore public JSON API.'
    );
    console.log(
      '[server] 200+ competitions in one request, incl. Arab leagues, CAF, World Cup'
    );
  } else if (source.isScrape()) {
    console.log(
      '[server] source: scrape — no API, no key. Scraping BBC Sport pages.'
    );
    console.log(
      `[server] ${SCRAPE_LEAGUES.length} competitions have tables; fixtures cover every competition BBC lists for a date`
    );
    console.log(
      '[server] not available here: crests, venue, referee, match stats, player search'
    );
  } else if (source.isEspn()) {
    console.log(
      `[server] source: espn (no API key needed) — scanning ${scanLeagues().length} of ${ESPN_LEAGUES.length} competitions`
    );
    console.log('[server] set SOURCE=apifootball with a key for full coverage');
  } else {
    console.log(
      `[server] source: apifootball — ${apiUrl} (${apiProvider} auth)`
    );
    if (!hasApiKey()) {
      console.warn(
        '[server] no API-Football key set — data routes will answer 401. Use SOURCE=espn to run without a key.'
      );
    }
  }
});
