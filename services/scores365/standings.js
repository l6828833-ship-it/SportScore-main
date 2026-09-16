/**
 * Standings from 365scores.
 *
 * The competition standings endpoint returns a full ranked table with
 * played / W / D / L / goals / points, reshaped to API-Football's structure.
 * Multi-group tables (cup phases) keep each group's label.
 */

const client = require('../../utils/scores365/client');
const nz = require('../../utils/scores365/normalize');
const { to365Id } = require('../../utils/scores365/leagues');

const getStandings = async (params = {}) => {
  const exposedId = Number(params.league);
  const compId = to365Id(exposedId);
  if (!compId) {
    return {
      error: `No table available for competition "${params.league}" on 365scores.`,
    };
  }

  let body;
  try {
    body = await client.standings(compId, {
      timezoneName: params.timezoneName,
    });
  } catch {
    return { error: 'Empty data after multiple attempts' };
  }

  const groups = Array.isArray(body.standings) ? body.standings : [];
  if (groups.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  /**
   * Group labels come from INSIDE a stage, not from the number of stages.
   *
   * This used to tag rows only when `body.standings` held more than one entry,
   * which is not how a group stage arrives. The World Cup comes back as ONE entry
   * of 48 rows, each carrying a `groupNum` (1..12), with the labels alongside in
   * `stage.groups`: [{num: 1, name: "المجموعة أ"}, ...]. Reading only the entry
   * count meant every row was tagged null, the consumer could not split them, and
   * the table rendered as 48 rows where position 1 appeared twelve times.
   *
   * So a row's label is looked up by its own `groupNum`, and a table is treated as
   * multi-group when the ROWS say so. A single-group league table still carries no
   * label, which is what keeps a normal league from being split into one section.
   */
  const multiStage = groups.length > 1;
  const allRows = [];
  let leagueName = null;
  for (const stage of groups) {
    const rows = stage.rows || [];
    const labels = new Map(
      (Array.isArray(stage.groups) ? stage.groups : [])
        .filter((g) => g && g.num != null)
        .map((g) => [Number(g.num), g.name || null])
    );
    const distinctGroups = new Set(
      rows.map((r) => r.groupNum).filter((n) => n != null)
    );
    const stageLabel = multiStage
      ? stage.displayName || stage.name || null
      : null;

    leagueName = leagueName || stage.displayName || null;

    for (const row of rows) {
      let groupName = stageLabel;
      if (distinctGroups.size > 1 && row.groupNum != null) {
        // The source's own label when it has one. The fallback keeps rows
        // separated when only the number is known — losing the split is worse
        // than an unlocalized label, and every payload seen so far names them.
        groupName = labels.get(Number(row.groupNum)) || `Group ${row.groupNum}`;
      }
      allRows.push(nz.standingRow(row, groupName));
    }
  }

  if (allRows.length === 0) {
    return { error: 'Empty data after multiple attempts' };
  }

  return {
    queryParams: params,
    league: {
      id: exposedId,
      name: leagueName,
      country: null,
      logo: nz.competitionLogo(compId),
      flag: null,
      season: nz.num(params.season),
    },
    standings: [allRows],
    updatedAt: Date.now(),
  };
};

module.exports = { getStandings };
