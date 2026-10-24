#!/usr/bin/env node
'use strict';

/**
 * Remove referral links that point at AGENT-TREE players.
 *
 *   node scripts/cleanup-agent-tree-referrals.js           # dry run (default): counts only
 *   node scripts/cleanup-agent-tree-referrals.js --apply   # write
 *
 * An agent-tree player (owner `users.parent_staff_id` is a SUPER_MASTER,
 * MASTER or AGENT — staff levels 4–6, or an EXECUTIVE staff row under one; the
 * rule lives in `packages/auth/src/agentPlayers.js`) is never a referrer: the
 * resolver (`services/user/src/modules/affiliate/referrerResolver.js`) refuses
 * their codes. Links made before that rule are removed here:
 *
 *   team rows   whose owner (by `ownername`, or by `referalCode`) is an
 *               agent-tree player — deleted
 *   users.refree  that holds an agent-tree player's exact `referalcode` —
 *               set to NULL (so nothing can rebuild the team row from it)
 *
 * The agent-tree players' own `referalcode` values are NOT touched: they stay
 * in the database and are inert.
 *
 * Idempotent: a second run finds nothing. Prints counts only — no names,
 * codes or ids.
 */

const path = require('path');
const { isAgentTree } = require('@ibitplay/auth');

/**
 * Pure selection — what the script would change. Exported for tests.
 *
 * @param {object} input
 * @param {Array<{id, level, parentLevel}>} input.staff
 * @param {Array<{id, name, referalcode, parent_staff_id}>} input.players  players with an owner
 * @param {Array<{ownername, membername, referalCode}>} input.teams
 * @param {Array<{id, refree}>} input.referred  users with a non-null `refree`
 */
function selectAgentTreeReferrals({ staff = [], players = [], teams = [], referred = [] }) {
  const agentStaff = new Set(
    staff
      .filter((s) => isAgentTree({ level: s.level, parentLevel: s.parentLevel ?? null }))
      .map((s) => String(s.id))
  );

  const agentPlayers = players.filter(
    (p) => p.parent_staff_id !== null && p.parent_staff_id !== undefined && agentStaff.has(String(p.parent_staff_id))
  );
  const agentNames = new Set(agentPlayers.map((p) => p.name).filter(Boolean));
  const agentCodes = new Set(agentPlayers.map((p) => p.referalcode).filter(Boolean));

  const teamRows = teams.filter((t) => agentNames.has(t.ownername) || agentCodes.has(t.referalCode));
  const refreeUsers = referred.filter((u) => u.refree && agentCodes.has(String(u.refree).trim()));

  return { agentPlayers, teamRows, refreeUsers };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { connect, QueryTypes } = require('@ibitplay/db');
  const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');

  const logger = createLogger({ name: 'cleanup-agent-tree-referrals', level: 'warn' });
  const config = loadEnv(
    { ...dbEnvShape, NODE_ENV: coercers.str('development') },
    { serviceDir: path.resolve(__dirname, '..') }
  );

  const db = await connect({ config, logger, domains: ['core', 'admin'] });
  const { sequelize } = db;
  const select = (sql) => sequelize.query(sql, { type: QueryTypes.SELECT });

  try {
    const [staff, players, teams, referred] = await Promise.all([
      select(`SELECT s.id, r.level, pr.level AS "parentLevel"
                FROM staff s
                LEFT JOIN roles r ON r.id = s.role_id
                LEFT JOIN staff p ON p.id = s.parent_id
                LEFT JOIN roles pr ON pr.id = p.role_id`),
      select(`SELECT id, name, referalcode, parent_staff_id FROM users WHERE parent_staff_id IS NOT NULL`),
      select(`SELECT ownername, membername, "referalCode" FROM team`),
      select(`SELECT id, refree FROM users WHERE refree IS NOT NULL AND refree <> ''`),
    ]);

    const { agentPlayers, teamRows, refreeUsers } = selectAgentTreeReferrals({ staff, players, teams, referred });

    console.log(`database:                     ${config.DB_NAME}`);
    console.log(`mode:                         ${apply ? 'APPLY' : 'dry run (pass --apply to write)'}`);
    console.log(`agent-tree players:           ${agentPlayers.length}`);
    console.log(`  of which hold a code:       ${agentPlayers.filter((p) => p.referalcode).length} (left in place, inert)`);
    console.log(`team rows to delete:          ${teamRows.length}`);
    console.log(`users.refree to clear:        ${refreeUsers.length}`);

    if (!apply || (!teamRows.length && !refreeUsers.length)) return;

    const result = await db.transaction(async (transaction) => {
      let deleted = 0;
      for (const row of teamRows) {
        const [, meta] = await sequelize.query(
          `DELETE FROM team WHERE ownername = :ownername AND membername = :membername AND "referalCode" = :referalCode`,
          { replacements: row, transaction }
        );
        deleted += meta?.rowCount ?? 0;
      }
      let cleared = 0;
      if (refreeUsers.length) {
        const [, meta] = await sequelize.query(`UPDATE users SET refree = NULL WHERE id IN (:ids)`, {
          replacements: { ids: refreeUsers.map((u) => u.id) },
          transaction,
        });
        cleared = meta?.rowCount ?? 0;
      }
      return { deleted, cleared };
    });

    console.log(`team rows deleted:            ${result.deleted}`);
    console.log(`users.refree cleared:         ${result.cleared}`);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = { selectAgentTreeReferrals };
