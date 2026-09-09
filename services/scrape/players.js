/**
 * Players for the scrape source.
 *
 * BBC has no player index and no leaderboard endpoint, but its fixture pages DO
 * carry goal scorers inside each match's event feed. So the top-scorers table is
 * COMPUTED: scan a window of scraped dates for one competition, tally goals per
 * player, and rank them.
 *
 * This is honest about its own limits. It counts only the matches on the dates
 * it scans, so early in a season, or with a short window, the totals are a
 * running count over that window rather than an official season tally. The
 * window is configurable, and results are cached, so it stays affordable.
 *
 * Player photos are not available: BBC carries none, and matching a scraped name
 * to a photo CDN is unreliable. Scorer rows therefore fall back to initials,
 * which the UI renders cleanly.
 */

const client = require('../../utils/scrape/client');
const catalogue = require('../../utils/scrape/leagues');
const cache = require('../../utils/cache');
const crests = require('../../utils/scrape/crests');
const { stableId } = require('../../utils/scrape/leagues');

/**
 * How many days back to scan when building a leaderboard.
 *
 * Each day is one cached page load, so the window trades completeness for speed.
 * 45 days covers roughly the last two months of a league, which is enough for a
 * meaningful "recent form" scorer table without a slow cold start; raise
 * SCRAPE_SCORERS_WINDOW_DAYS for a fuller season count.
 */
const WINDOW_DAYS = Number(process.env.SCRAPE_SCORERS_WINDOW_DAYS) || 45;
/** Hard ceiling so a huge window cannot run away. */
const MAX_DATES = Number(process.env.SCRAPE_SCORERS_MAX_DATES) || 120;
const TTL = Number(process.env.SCRAPE_SCORERS_TTL_SECONDS) || 6 * 60 * 60;

const todayKey = () => new Date().toISOString().slice(0, 10);

function shiftDate(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/**
 * Tally goals for one competition across the window.
 *
 * `apiFootballId` selects the competition; only its events count. Own goals are
 * excluded from a scorer's tally, matching how leaderboards are kept.
 */
async function computeScorers(apiFootballId) {
  const today = todayKey();
  const dates = [];
  for (let i = 0; i < Math.min(WINDOW_DAYS, MAX_DATES); i++) {
    dates.push(shiftDate(today, -i));
  }

  const tally = new Map();

  const ensure = (urn, name, teamName) => {
    let row = tally.get(urn);
    if (!row) {
      row = { urn, name, team: teamName, goals: 0, assists: 0 };
      tally.set(urn, row);
    }
    // Keep the most recent team seen for the player.
    if (teamName) row.team = teamName;
    return row;
  };

  for (const dateKey of dates) {
    let payload;
    try {
      payload = await client.scoresFixtures(dateKey);
    } catch {
      continue; // a missing day must not abort the whole scan
    }

    for (const group of payload.eventGroups || []) {
      const league = catalogue.resolveLabel(group.displayLabel);
      // Only a KNOWN competition (one with a catalogue slug) is counted, and it
      // must be this one. Unmapped competitions share a derived id space where
      // two different leagues can collide — which is how a Ukrainian league's
      // goals once leaked into the Premier League table. Requiring a real slug
      // and an exact id closes that.
      if (league.unmapped || !league.slug) continue;
      if (league.apiFootballId !== apiFootballId) continue;

      for (const stage of group.secondaryGroups || []) {
        for (const event of stage.events || []) {
          for (const which of ['home', 'away']) {
            const side = event[which] || {};
            const teamName = side.fullName || side.shortName || null;

            for (const entry of side.actions || []) {
              const category = String(entry.actionType || '').toLowerCase();
              if (category !== 'goal') continue;
              if (!entry.playerUrn && !entry.playerName) continue;

              for (const action of entry.actions || []) {
                const type = String(action.type || '').toLowerCase();
                // Own goals do not count towards a scorer.
                if (type.includes('own')) continue;
                if (/miss|saved|shootout/.test(type)) continue;

                const urn = entry.playerUrn || `name:${entry.playerName}`;
                ensure(urn, entry.playerName || '—', teamName).goals += 1;
              }
            }
          }
        }
      }
    }
  }

  const rows = [...tally.values()]
    .filter((r) => r.goals > 0)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  return rows;
}

/**
 * Top scorers, in the API-Football `/players/topscorers` shape so the consumer
 * treats this identically to the other sources.
 */
const getTopScorers = async (params = {}) => {
  const league = catalogue.resolveLeague(params.league);
  if (!league || !league.slug) {
    return {
      error: `No scorer data for competition "${params.league}". GET /leagues/getLeagues lists the supported ones.`,
    };
  }

  const key = `scrape:scorers:${league.apiFootballId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rows = await computeScorers(league.apiFootballId);
  const top = rows.slice(0, 25);

  // Resolve each club's crest so the leaderboard shows logos, not just names.
  await crests.preload(league.slug);
  const teamLogos = new Map();
  for (const r of top) {
    if (r.team && !teamLogos.has(r.team)) {
      teamLogos.set(r.team, await crests.crestFor(league.slug, r.team));
    }
  }

  const result = {
    queryParams: params,
    // Signals that these totals are computed over a scan window, not an official
    // season tally — the consumer surfaces this honestly.
    computed: true,
    windowDays: Math.min(WINDOW_DAYS, MAX_DATES),
    topScorers: top.map((r) => ({
      player: {
        id: stableId(r.urn),
        name: r.name,
        nationality: null,
        photo: null,
      },
      statistics: [
        {
          team: {
            id: stableId(r.team || ''),
            name: r.team,
            logo: teamLogos.get(r.team) || null,
          },
          games: { appearences: null },
          goals: { total: r.goals, assists: null },
          penalty: { scored: null },
        },
      ],
    })),
    updatedAt: Date.now(),
  };

  if (result.topScorers.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  cache.set(key, result, TTL);
  return result;
};

const notSupported = (what) => async () => {
  const error = new Error(
    `${what} are not available from the scrape source. Use SOURCE=espn or SOURCE=apifootball.`
  );
  error.status = 501;
  throw error;
};

module.exports = {
  getTopScorers,
  // Player search still needs a directory BBC does not have.
  searchProfiles: notSupported('Player searches'),
  getPlayers: notSupported('Player searches'),
  getAssists: notSupported('Top assists'),
  getSquads: notSupported('Squads'),
  getPlayerSeasons: notSupported('Player seasons'),
};
