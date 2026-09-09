# SportScore API Manual

Welcome to the SportScore API! This API provides various endpoints to retrieve football-related data, such as player statistics, team information, and match fixtures. Below is a comprehensive guide to all available endpoints.

## Quick start — no API at all

```bash
npm install
npm start                      # http://localhost:4000
curl localhost:4000/health     # "source": "scrape", "ready": true
```

Defaults to `SOURCE=scrape`, which scrapes BBC Sport web pages. No API, no key,
no account, no quota. A whole day of fixtures across every competition BBC lists
arrives in **one** request — around 115 fixtures across 14 competitions — with
goal scorers, cards, half-time scores and a real match clock.

It reads the JSON that the page embeds for its own rendering
(`window.__INITIAL_DATA__`) rather than parsing rendered markup. That is
deliberate: CSS selectors on a modern site are hashed class names that change on
every frontend build — see `controllers/scrapeController.js`, which is already
broken for exactly that reason — whereas the embedded payload is what the page's
own JavaScript consumes.

```bash
curl "localhost:4000/fixtures/getFixtures"                   # today, all competitions
curl "localhost:4000/fixtures/getFixtures?date=2026-09-08"
curl "localhost:4000/fixtures/getFixtures?live=all"
curl "localhost:4000/fixtures/getFixtureById?id=401879291"    # + events & statistics
curl "localhost:4000/standings/getStandings?league=39"
curl "localhost:4000/leagues/getLeagues"
curl "localhost:4000/teams/getTeams?league=39"
curl "localhost:4000/players/searchPlayers?search=salah"
```

Competition ids are API-Football's (39 = Premier League, 2 = Champions League,
307 = Saudi Pro League) whichever source is active, so nothing downstream has to
care which one is running. `GET /leagues/getLeagues` lists them all.

### Three sources

| | `scrape` (default) | `espn` | `apifootball` |
| --- | --- | --- | --- |
| API used | **none** | public JSON | API-Football |
| API key | **none** | none | required |
| Quota | none | none | 100/day free |
| Requests for a full day of fixtures | **1** | one per competition | 1 |
| Live scores + real match clock | yes | yes | yes |
| Goal scorers, cards, half-time scores | yes | yes | yes |
| Standings | 17 competitions | yes | yes |
| Team crests | **no** | yes | yes |
| Venue / referee | **no** | yes | yes |
| Match statistics | **no** | yes | yes |
| Player search | **no** (501) | yes | yes |
| Top scorer leaderboards | **no** (501) | **no** (501) | yes |
| Competitions | every one BBC lists for a date | ~48 | ~1200 |
| Stability | reads an embedded page payload | undocumented endpoints | documented and versioned |

All three return identical response shapes, so switching is one env line.

For crests, venues and match statistics without needing a key:

```bash
SOURCE=espn
```

For everything, including leaderboards:

```bash
SOURCE=apifootball
key=your_api_football_key
API_PROVIDER=direct       # or `rapidapi`, matching where the key came from
```

`API_PROVIDER` must match the key's origin. A mismatch does **not** produce an
auth error — the upstream answers HTTP 200 with an empty result set, which is
indistinguishable from "no fixtures today". This is the most confusing way to
misconfigure this server, so check `/health` after changing it.

### Notes

- **No auth and no rate limiting on any route.** Keep it on localhost, or set
  `CORS_ORIGIN` and put it behind something that does.
- MongoDB is optional (`DB=`). Without it the cache is in-memory only, so a
  restart re-fetches — free on `espn`, real quota on `apifootball`.
- On `espn`, a fixture date costs one request **per competition**, so
  `ESPN_LEAGUES` controls the scan (blank = ~30 popular, `all` = everything, or a
  comma-separated list of slugs).
- `/news/*` scrapes goal.com with Puppeteer. Its selectors are hashed CSS-module
  names that break whenever that site rebuilds — treat those routes as
  best-effort. `.npmrc` skips the Chromium download; remove that line and
  reinstall if you want them.
- `GET /health` reports the active source and whether it can serve data.
  `GET /quota` reports the remaining upstream allowance (`apifootball` only).
- A legitimately empty result is `HTTP 200` with `{"error": "Empty data after
  multiple attempts"}`. Real failures use proper status codes: 401 missing key,
  501 unsupported by the source, 502 upstream error, 503 unreachable.

## Table of Contents

- [General Information](#general-information)
- [Endpoints](#endpoints)
  - [Leagues](#leagues)
  - [Teams](#teams)
  - [Venues](#venues)
  - [Standings](#standings)
  - [Fixtures](#fixtures)
  - [Players](#players)
- [Status Codes](#status-codes)
- [Support](#support)

## General Information

- **Base URL:** `http://localhost:3000` (or your deployed API URL)
- **API Version:** 1.0.0
- **Authentication:** No authentication is required for the current version.

## Endpoints

### Leagues

- **Get Leagues**
  - Endpoint: `/leagues/getLeagues`
  - Description: Retrieve available leagues and cups.
  - Method: `GET`
- **Get Leagues from Database**
  - Endpoint: `/leagues/db/getLeagues`
  - Description: Retrieve leagues data from the database.
  - Method: `GET`

### Teams

- **Get Teams**
  - Endpoint: `/teams/getTeams`
  - Description: Retrieve available teams.
  - Method: `GET`
- **Get Team Season Statistics**
  - Endpoint: `/teams/getTeamSeasonStatistics`
  - Description: Retrieve the statistics of a team for a given competition and season.
  - Method: `GET`
- **Get Teams from Database**
  - Endpoint: `/teams/db/getTeams`
  - Description: Retrieve teams data from the database.
  - Method: `GET`
- **Get Team Statistics from Database**
  - Endpoint: `/teams/db/getStatistics`
  - Description: Retrieve team statistics from the database.
  - Method: `GET`

### Venues

- **Get Team Venues**
  - Endpoint: `/venues/getTeamVenues`
  - Description: Retrieve venues for teams.
  - Method: `GET`
- **Get Venues from Database**
  - Endpoint: `/venues/db/getTeamVenues`
  - Description: Retrieve team venues from the database.
  - Method: `GET`

### Standings

- **Get Standings**
  - Endpoint: `/standings/getStandings`
  - Description: Retrieve standings for a league.
  - Method: `GET`
- **Get Standings from Database**
  - Endpoint: `/standings/db/getStandings`
  - Description: Retrieve standings from the database.
  - Method: `GET`

### Fixtures

- **Get Fixtures**
  - Endpoint: `/fixtures/getFixtures`
  - Description: Retrieve fixtures.
  - Method: `GET`
- **Get Fixture Head to Head**
  - Endpoint: `/fixtures/getFixtureHeadToHead`
  - Description: Retrieve head-to-head data for two teams.
  - Method: `GET`
- **Get Match Statistics**
  - Endpoint: `/fixtures/getMatchStatistics`
  - Description: Retrieve match statistics.
  - Method: `GET`
- **Get Match Events**
  - Endpoint: `/fixtures/getMatchEvents`
  - Description: Retrieve events of a match.
  - Method: `GET`
- **Get Match Lineups**
  - Endpoint: `/fixtures/getMatchLineups`
  - Description: Retrieve lineups of a match.
  - Method: `GET`
- **Get Match Player Statistics**
  - Endpoint: `/fixtures/getMatchPlayerStatistics`
  - Description: Retrieve player statistics for a match.
  - Method: `GET`
- **Get Fixtures from Database**
  - Endpoint: `/fixtures/db/getFixtures`
  - Description: Retrieve fixtures from the database.
  - Method: `GET`
- **Get Head to Head from Database**
  - Endpoint: `/fixtures/db/getHeadToHead`
  - Description: Retrieve head-to-head data from the database.
  - Method: `GET`
- **Get Statistics from Database**
  - Endpoint: `/fixtures/db/getStatistics`
  - Description: Retrieve match statistics from the database.
  - Method: `GET`
- **Get Events from Database**
  - Endpoint: `/fixtures/db/getEvents`
  - Description: Retrieve match events from the database.
  - Method: `GET`
- **Get Lineups from Database**
  - Endpoint: `/fixtures/db/getLineups`
  - Description: Retrieve match lineups from the database.
  - Method: `GET`
- **Get Players from Database**
  - Endpoint: `/fixtures/db/getPlayers`
  - Description: Retrieve player data from the database.
  - Method: `GET`

### Players

- **Get Squads**
  - Endpoint: `/players/getSquads`
  - Description: Retrieve squads.
  - Method: `GET`
- **Get Players**
  - Endpoint: `/players/getPlayers`
  - Description: Retrieve players.
  - Method: `GET`
- **Get Top Scorers**
  - Endpoint: `/players/getTopScorers`
  - Description: Retrieve top scorers.
  - Method: `GET`
- **Get Top Assists**
  - Endpoint: `/players/getTopAssists`
  - Description: Retrieve top assists.
  - Method: `GET`
- **Get Squads from Database**
  - Endpoint: `/players/db/getSquads`
  - Description: Retrieve squads from the database.
  - Method: `GET`
- **Get Players from Database**
  - Endpoint: `/players/db/getPlayers`
  - Description: Retrieve players from the database.
  - Method: `GET`
- **Get Top Scorers from Database**
  - Endpoint: `/players/db/getTopScorers`
  - Description: Retrieve top scorers from the database.
  - Method: `GET`
- **Get Top Assists from Database**
  - Endpoint: `/players/db/getTopAssists`
  - Description: Retrieve top assists from the database.
  - Method: `GET`

## Status Codes

- `200 OK`: The request was successful.
- `400 Bad Request`: The request could not be understood or was missing required parameters.
- `404 Not Found`: Resource was not found.
- `500 Internal Server Error`: An error occurred on the server.

## Support

For any queries or support, please contact [nghiapham1026@gmail.com](mailto:nghiapham1026@gmail.com).
