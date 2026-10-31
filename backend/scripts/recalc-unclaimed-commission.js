#!/usr/bin/env node
'use strict';

/**
 * Re-price UNCLAIMED affiliate commission from the old flat % to hash.game's formula
 * (wager × 1% × commission rate × game rate, migration 134).
 *
 *   node scripts/recalc-unclaimed-commission.js           dry run: rows, old total, new total, by category
 *   node scripts/recalc-unclaimed-commission.js --apply   backup table, then update `rewards.amount`
 *
 * Only `type = 'commission'`, `claimed = false`, `voided = false` rows. Claimed commission is left
 * alone (documented: paid money is not clawed back). Each row's stake (`source`, `ref` →
 * wager_activity) gives its category; a row with no stake link counts as slots. The old % is
 * `siteconfig.comissionpercent` (what priced these rows); new amount = old amount × new% / old%,
 * so the reward currency and its rate at the time are kept. Backup: rewards_commission_bak_<stamp>.
 */

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const config = require('../services/user/src/config');

const APPLY = process.argv.includes('--apply');

async function main() {
  const logger = createLogger({ name: 'recalc-commission', level: 'warn' });
  const connection = await db.connect({ config, logger, service: 'user-service' });
  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { type: 'SELECT', replacements });
  try {
    console.log(`database: ${config.DB_NAME} @ ${config.DB_HOST}`);
    const [site] = await q(
      'SELECT comissionpercent, affiliate_commission_rate, affiliate_game_rates FROM siteconfig ORDER BY id LIMIT 1'
    );
    const oldPercent = Number(site?.comissionpercent ?? 0);
    if (!(oldPercent > 0)) throw new Error('siteconfig.comissionpercent is 0 — nothing to re-price from');
    const rate = Number(site.affiliate_commission_rate ?? 25);
    const games = typeof site.affiliate_game_rates === 'string' ? JSON.parse(site.affiliate_game_rates) : site.affiliate_game_rates || {};
    // new% of the stake for each category, as a fraction of the old %.
    const factor = (category) => (0.01 * (rate / 100) * (Number(games[category] ?? games.slots ?? 60) / 100) * 100) / oldPercent;

    const rows = await q(
      `SELECT r.id, r.amount, COALESCE(w.category, 'slots') AS category
         FROM rewards r
         LEFT JOIN wager_activity w ON w.source = r.source AND w.ref = r.ref
        WHERE r.type = 'commission' AND r.claimed = false AND COALESCE(r.voided, false) = false`
    );
    const byCategory = {};
    let oldTotal = 0;
    let newTotal = 0;
    for (const row of rows) {
      const amount = Number(row.amount);
      const next = Math.floor(amount * factor(row.category) * 1e8) / 1e8;
      row.next = next.toFixed(8);
      oldTotal += amount;
      newTotal += next;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    }
    console.log(`old flat ${oldPercent}% → rate ${rate}% × game rates ${JSON.stringify(games)}`);
    console.log(`unclaimed commission rows: ${rows.length}`, byCategory);
    console.log(`total (reward currency): ${oldTotal.toFixed(8)} → ${newTotal.toFixed(8)}`);

    if (!APPLY) {
      console.log('dry run — nothing changed. Re-run with --apply.');
      return;
    }
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    await connection.sequelize.transaction(async (transaction) => {
      const run = (sql, replacements) => connection.sequelize.query(sql, { transaction, replacements, type: 'RAW' });
      await run(
        `CREATE TABLE rewards_commission_bak_${stamp} AS
           SELECT id, amount FROM rewards WHERE type = 'commission' AND claimed = false AND COALESCE(voided, false) = false`
      );
      for (const row of rows) {
        await run('UPDATE rewards SET amount = :amount WHERE id = :id AND claimed = false', { id: row.id, amount: row.next });
      }
    });
    console.log(`updated ${rows.length} rows. backup: rewards_commission_bak_${stamp}`);
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('failed:', error.message);
  process.exit(1);
});
