#!/usr/bin/env node
'use strict';

/**
 * Reset every player's VIP wager to 0 and their level to the start (Beginner / level 0).
 *
 *   node scripts/reset-player-wager.js                    dry run: how many players, total wager, top 10
 *   node scripts/reset-player-wager.js --apply            backup tables first, then reset (one transaction)
 *   node scripts/reset-player-wager.js --restore=<stamp>  put back a backup made by --apply
 *
 * What it changes:   userwager.wager → '0', users.level → 0, cronbonus.viplevel → 0,
 *                    plus one userwager_history row per player (old → 0) for the audit trail.
 * What it leaves:    wager_activity (bet history), rewards / commission / bonuses already paid,
 *                    balances. Level-up bonuses are keyed `vip:level_up:<user>:<level>`, so climbing
 *                    back does NOT pay a level twice.
 * Side effect:       the withdrawal 3x rollover reads userwager — after a reset players must wager
 *                    their deposits again before they can withdraw.
 *
 * Reads DB_* from backend/.env (casino-service config). Backups: userwager_bak_<stamp>,
 * users_level_bak_<stamp>, cronbonus_level_bak_<stamp>.
 */

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const config = require('../services/casino/src/config');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RESTORE = (args.find((a) => a.startsWith('--restore=')) || '').split('=')[1];

async function main() {
  const logger = createLogger({ name: 'reset-player-wager', level: 'warn' });
  const connection = await db.connect({ config, logger, service: 'user-service' });
  const q = (sql, options = {}) => connection.sequelize.query(sql, { type: 'SELECT', ...options });
  try {
    console.log(`database: ${config.DB_NAME} @ ${config.DB_HOST}`);

    if (RESTORE) {
      if (!/^\d{14}$/.test(RESTORE)) throw new Error('--restore needs the 14-digit stamp printed by --apply');
      await connection.sequelize.transaction(async (transaction) => {
        const opts = { transaction, type: 'RAW' };
        await connection.sequelize.query(`UPDATE userwager u SET wager = b.wager FROM userwager_bak_${RESTORE} b WHERE b.uid = u.uid`, opts);
        await connection.sequelize.query(`UPDATE users u SET level = b.level FROM users_level_bak_${RESTORE} b WHERE b.id = u.id`, opts);
        await connection.sequelize.query(`UPDATE cronbonus c SET viplevel = b.viplevel FROM cronbonus_level_bak_${RESTORE} b WHERE b.userid = c.userid`, opts);
      });
      console.log(`restored from backup ${RESTORE}`);
      return;
    }

    const [summary] = await q(
      `SELECT COUNT(*)::int AS players,
              COUNT(*) FILTER (WHERE COALESCE(NULLIF(wager, ''), '0')::numeric > 0)::int AS with_wager,
              COALESCE(SUM(COALESCE(NULLIF(wager, ''), '0')::numeric), 0)::text AS total_wager_usd
         FROM userwager`
    );
    const [levels] = await q('SELECT COUNT(*) FILTER (WHERE level > 0)::int AS above_zero FROM users');
    const top = await q(
      `SELECT w.uid, u.name, w.wager FROM userwager w LEFT JOIN users u ON u.id = w.uid
        ORDER BY COALESCE(NULLIF(w.wager, ''), '0')::numeric DESC LIMIT 10`
    );
    console.log(`players with a wager row: ${summary.players} (${summary.with_wager} above 0), total ${summary.total_wager_usd} USD`);
    console.log(`users with level > 0: ${levels.above_zero}`);
    console.table(top);

    if (!APPLY) {
      console.log('dry run — nothing changed. Re-run with --apply to reset.');
      return;
    }

    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    await connection.sequelize.transaction(async (transaction) => {
      const run = (sql) => connection.sequelize.query(sql, { transaction, type: 'RAW' });
      await run(`CREATE TABLE userwager_bak_${stamp} AS SELECT * FROM userwager`);
      await run(`CREATE TABLE users_level_bak_${stamp} AS SELECT id, level FROM users`);
      await run(`CREATE TABLE cronbonus_level_bak_${stamp} AS SELECT userid, viplevel FROM cronbonus`);
      await run(
        `INSERT INTO userwager_history (uid, previous_wager, new_wager, updated_at)
         SELECT uid, wager, '0', NOW() FROM userwager WHERE COALESCE(NULLIF(wager, ''), '0')::numeric <> 0`
      );
      await run(`UPDATE userwager SET wager = '0'`);
      await run('UPDATE users SET level = 0 WHERE level IS DISTINCT FROM 0');
      await run('UPDATE cronbonus SET viplevel = 0 WHERE viplevel IS DISTINCT FROM 0');
    });
    console.log(`reset done. backup stamp: ${stamp}  (undo: node scripts/reset-player-wager.js --restore=${stamp})`);
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('failed:', error.message);
  process.exit(1);
});
