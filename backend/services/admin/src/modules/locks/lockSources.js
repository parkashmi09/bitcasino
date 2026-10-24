'use strict';

const { literal } = require('sequelize');

const { LOCK_FIELDS } = require('./locks.constants');

/**
 * WHY a lock column is set — so unlocking an agent lifts only what it imposed.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE BUG
 *
 * Locking an agent copies the lock onto every account beneath it. Unlocking
 * the agent then wrote `false` over the same rows — including a player an
 * operator had locked ON PURPOSE before, or a sub-agent another ancestor had
 * locked. A lock set directly on a child was silently undone by a click on
 * its parent.
 *
 * THE RECORD (migration 062, `lock_sources` JSONB on `users` and `staff`)
 *
 *     { "<column>": { "own": <bool>, "by": ["<agentId>", …] } }
 *
 *   own — the lock was set on this account directly
 *   by  — the agents whose subtree lock is holding it
 *
 * The column is `own OR by is non-empty`. A cascade lock adds the agent to
 * `by`; a cascade unlock removes it and clears the column only when nothing
 * else holds it. A direct lock sets `own`; a direct unlock is the operator's
 * explicit decision about THIS account and clears both.
 *
 * ── ROWS FROM BEFORE THE COLUMN ─────────────────────────────────────────
 * A locked row with no entry cannot say where its lock came from, so it is
 * read as an OWN lock and a cascade never lifts it. That is the safe direction
 * for a lock to fail in; the operator unlocks such a row directly once.
 *
 * ── A COLUMN CHANGED BY ANOTHER PATH ────────────────────────────────────
 * `own` is only believed while the column is actually set, and a set column
 * with an empty `by` is own by definition — so a lock flipped by a path that
 * does not maintain `lock_sources` (the sports bet-lock switch) is still read
 * correctly.
 *
 * Every column name below comes from `LOCK_FIELDS`, never from input, and
 * agent ids are coerced to integers before they reach the SQL.
 * ═════════════════════════════════════════════════════════════════════════
 */

const LOCK_COLUMNS = Object.freeze(Object.values(LOCK_FIELDS));

const assertColumn = (column) => {
  if (!LOCK_COLUMNS.includes(column)) throw new Error(`Not a lock column: ${column}`);
  return column;
};

const agentKey = (agentId) => {
  const id = Number(agentId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Bad agent id: ${agentId}`);
  return String(id);
};

/**
 * The `by` entry a cascade records. A lock from `POST /admin/locks` is the
 * bare agent id; a SUSPENSION of the agent (`status` ≠ active) is
 * `suspend:<id>` — its own holder, so lifting the lock never reactivates a
 * suspended agent's downline and reactivating never lifts the lock.
 */
const CASCADE_KINDS = Object.freeze({ LOCK: 'lock', SUSPEND: 'suspend' });
const sourceKey = (agentId, kind = CASCADE_KINDS.LOCK) => {
  if (kind === CASCADE_KINDS.SUSPEND) return `suspend:${agentKey(agentId)}`;
  if (kind !== CASCADE_KINDS.LOCK) throw new Error(`Bad cascade kind: ${kind}`);
  return agentKey(agentId);
};

const SOURCES = `COALESCE(lock_sources, '{}'::jsonb)`;
const byOf = (column) => `COALESCE(${SOURCES}->'${column}'->'by', '[]'::jsonb)`;

/** Is this row's lock its own — see "ROWS FROM BEFORE" and "ANOTHER PATH". */
const ownOf = (column) =>
  `(COALESCE("${column}", false) AND (COALESCE((${SOURCES}->'${column}'->>'own')::boolean, true)` +
  ` OR jsonb_array_length(${byOf(column)}) = 0))`;

/**
 * The `lock_sources` value for a DIRECT change on one account.
 *
 * @param {Record<string, boolean>} changes lock column → locked; other keys ignored.
 * @returns {import('sequelize').Utils.Literal|null} null when no lock column changes.
 */
function directSources(changes) {
  const columns = Object.keys(changes).filter((c) => LOCK_COLUMNS.includes(c));
  if (!columns.length) return null;

  let expr = SOURCES;
  for (const column of columns) {
    expr = changes[column]
      ? `jsonb_set(${expr}, '{${column}}', jsonb_build_object('own', true, 'by', ${byOf(column)}))`
      : `jsonb_set(${expr}, '{${column}}', '{"own": false, "by": []}'::jsonb)`;
  }
  return literal(expr);
}

/**
 * The SET clause for a CASCADE from `agentId` onto the accounts beneath it.
 *
 * @param {Record<string, boolean>} changes lock column → locked.
 * @param {{ kind?: 'lock'|'suspend' }} [options] what is holding the lock — see `sourceKey`.
 * @returns {Record<string, import('sequelize').Utils.Literal>} attributes for `Model.update`.
 */
function cascadeUpdate(changes, agentId, { kind = CASCADE_KINDS.LOCK } = {}) {
  const key = sourceKey(agentId, kind);
  const set = {};
  let sources = SOURCES;

  for (const [column, locked] of Object.entries(changes)) {
    assertColumn(column);
    const without = `(${byOf(column)} - '${key}')`;
    const by = locked ? `(${without} || jsonb_build_array('${key}'))` : without;

    sources = `jsonb_set(${sources}, '{${column}}', jsonb_build_object('own', ${ownOf(column)}, 'by', ${by}))`;
    // Every expression reads the row as it was BEFORE this UPDATE, so `own`
    // and `by` here are the old values — exactly what the decision needs.
    set[column] = literal(locked ? 'true' : `(${ownOf(column)} OR jsonb_array_length(${without}) > 0)`);
  }

  set.lock_sources = literal(sources);
  return set;
}

module.exports = { LOCK_COLUMNS, CASCADE_KINDS, directSources, cascadeUpdate };
