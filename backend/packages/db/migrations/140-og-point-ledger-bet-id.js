'use strict';

/**
 * Old Original-games point-ledger rows get the `bet_id` new ones carry: the og_transactions id of the
 * round's first row (a rollback without `round_id` takes the round of the transaction it undoes).
 * Agent rows: `mssports.point_ledger.entry_ref = 'og:<tx>'`. Direct rows: `entry_ref = 'og:<tx>'`
 * (old game rows) or `ref = 'OG:<tx>'` (wallet-trigger rows). Unlabelled BALANCE_CHANGE rows name no
 * transaction, so they stay as they are.
 */
const ROUND_BET_IDS = `
  SELECT t.transaction_id,
         COALESCE((SELECT MIN(x.id) FROM og_transactions x
                    WHERE x.user_id = t.user_id AND x.round_id = COALESCE(t.round_id, o.round_id)), t.id) AS bet_id
    FROM og_transactions t
    LEFT JOIN og_transactions o ON o.transaction_id = t.reference_transaction_id`;

async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`WITH r AS (${ROUND_BET_IDS})
           UPDATE mssports.point_ledger p SET bet_id = r.bet_id
             FROM r WHERE p.entry_ref = 'og:' || r.transaction_id AND p.bet_id IS NULL`);
  await q(`WITH r AS (${ROUND_BET_IDS})
           UPDATE mssports.point_ledger_direct p SET bet_id = r.bet_id
             FROM r WHERE (p.entry_ref = 'og:' || r.transaction_id OR p.ref = 'OG:' || r.transaction_id) AND p.bet_id IS NULL`);
}

// Backfill only: new rows carry the same bet_id from the code, so there is nothing to undo.
async function down() {}

module.exports = { up, down };
