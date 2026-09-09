/**
 * Shared table-row extraction.
 *
 * The table payload nests differently per competition — a domestic league has
 * one flat set of rows, a cup has several under named stages — so rows are found
 * by SHAPE rather than by a fixed path: a standings row is the only node
 * carrying both `rank` and `points`.
 *
 * Lives in its own module because both the standings and the teams service need
 * it, and duplicating a structural assumption is how the two drift apart.
 */

const SKIP_KEYS = new Set(['masthead', 'productNav', 'searchResults']);

function isRow(item) {
  return item && typeof item === 'object' && 'rank' in item && 'points' in item;
}

/** Every row group in the payload, each with the label it sat under. */
function collectGroups(node, out = [], groupName = null, depth = 0) {
  if (!node || depth > 10) return out;

  if (Array.isArray(node)) {
    const rows = node.filter(isRow);
    if (rows.length > 0) {
      out.push({ name: groupName, rows });
      return out;
    }
    for (const item of node) collectGroups(item, out, groupName, depth + 1);
    return out;
  }

  if (typeof node === 'object') {
    const label =
      node.displayLabel || node.name || node.title || node.heading || groupName;
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key)) continue;
      collectGroups(
        value,
        out,
        typeof label === 'string' ? label : groupName,
        depth + 1
      );
    }
  }
  return out;
}

/** Flat list of every row across all groups. */
function collectRows(payload) {
  return collectGroups(payload).flatMap((group) => group.rows);
}

module.exports = { collectGroups, collectRows, isRow };
