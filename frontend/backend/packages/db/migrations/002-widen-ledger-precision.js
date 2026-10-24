'use strict';

/**
 * Widen the ledger's money columns from NUMERIC(18,2) to NUMERIC(30,8).
 *
 * The baseline schema stores `credits_ledger.balance`, `closing`, `netamount`,
 * `commission`, `profit` and `loss` at 2 decimal places. That is fine for INR
 * but wrong for every crypto balance on the platform: a closing balance of
 * 0.50000000 USDT is written as 0.50, and a BTC balance of 0.00012345 is
 * written as 0.00 — the statement stops matching the wallet.
 *
 * `amount` is already unconstrained NUMERIC, so the movement itself was always
 * exact; only the recorded balances were being truncated.
 *
 * Widening is safe and non-destructive: NUMERIC(30,8) holds every value
 * NUMERIC(18,2) could, so no existing row changes.
 */

const COLUMNS = ['balance', 'closing', 'netamount', 'commission', 'profit', 'loss'];

async function up({ sequelize, transaction, logger }) {
  for (const column of COLUMNS) {
    // The baseline is the source of truth for which columns exist, but a
    // deployment may have diverged — skip anything that is not there.
    const [exists] = await sequelize.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'credits_ledger' AND column_name = :column`,
      { replacements: { column }, type: sequelize.QueryTypes.SELECT, transaction }
    );
    if (!exists) {
      logger?.warn(`credits_ledger.${column} does not exist — skipping`);
      continue;
    }

    await sequelize.query(
      `ALTER TABLE credits_ledger ALTER COLUMN "${column}" TYPE NUMERIC(30,8)`,
      { transaction }
    );
  }

  logger?.info(`Widened ${COLUMNS.length} credits_ledger columns to NUMERIC(30,8)`);
}

async function down({ sequelize, transaction, logger }) {
  // Narrowing rounds every stored value to 2 decimal places — real data loss.
  // Gated behind the same flag as the destructive baseline revert.
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Narrowing these columns back to NUMERIC(18,2) rounds away 6 decimal places of every recorded balance. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if that is really intended.'
    );
  }

  for (const column of COLUMNS) {
    await sequelize.query(`ALTER TABLE credits_ledger ALTER COLUMN "${column}" TYPE NUMERIC(18,2)`, { transaction });
  }
  logger?.warn('Narrowed credits_ledger money columns back to NUMERIC(18,2) — precision lost');
}

module.exports = { up, down, COLUMNS };
