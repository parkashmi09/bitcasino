'use strict';

/**
 * `ccdeposit` — crypto amounts stored to two decimal places.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NUMERIC(10,2) FOR A BITCOIN AMOUNT
 *
 *     price   numeric(10,2)
 *     amount  numeric(10,2)
 *
 * `price` is what the player asked to deposit and `amount` is what CCPayment
 * says to send. Both are crypto quantities, and both were rounded to two
 * decimal places on the way in by Postgres — silently, because a NUMERIC cast
 * rounds rather than erroring.
 *
 * For USDT that loses fractions of a cent. For BTC it is total: 0.0012 BTC —
 * roughly a hundred dollars — is stored as `0.00`. Anything reading this table
 * to reconcile a deposit sees zero and cannot match it against what actually
 * arrived on chain.
 *
 * `10,2` also caps the value at 99,999,999.99. A deposit of a larger number of
 * a low-value coin — DOGE, SHIB — overflows and the insert fails outright.
 *
 * Widened to `NUMERIC(30,8)`, the same shape as `credits_ledger` (migration
 * 002) and every money column written since. Eight places is a satoshi.
 *
 * ── WHAT THIS CANNOT FIX ─────────────────────────────────────────────────
 *
 * Existing rows keep the values they have. The digits were discarded when the
 * row was written, and nothing in the database knows what they were — the only
 * remaining record of a historical deposit's true size is the blockchain and
 * CCPayment's own dashboard. Rows written from here on carry the full amount.
 */

async function up({ sequelize, transaction, logger }) {
  const [[before]] = await sequelize.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE price = 0 OR amount = 0)::int AS zeroed
       FROM ccdeposit`,
    { transaction }
  );

  await sequelize.query(
    `ALTER TABLE ccdeposit
       ALTER COLUMN price  TYPE NUMERIC(30,8),
       ALTER COLUMN amount TYPE NUMERIC(30,8)`,
    { transaction }
  );

  if (before.zeroed) {
    logger?.warn(
      { rows: before.total, zeroed: before.zeroed },
      'ccdeposit holds rows whose crypto amount rounded to zero under NUMERIC(10,2). ' +
        'Those digits were discarded on insert and cannot be recovered from the database — ' +
        'the blockchain and the CCPayment dashboard are the only remaining record.'
    );
  }

  logger?.info({ rows: before.total }, 'ccdeposit amounts widened to NUMERIC(30,8)');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Reverting narrows ccdeposit.price and .amount back to two decimal places, which ' +
        'rounds every crypto amount recorded since this ran — a BTC deposit becomes 0.00. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }

  await sequelize.query(
    `ALTER TABLE ccdeposit
       ALTER COLUMN price  TYPE NUMERIC(10,2),
       ALTER COLUMN amount TYPE NUMERIC(10,2)`,
    { transaction }
  );

  logger?.warn('Narrowed ccdeposit amounts back to two decimal places');
}

module.exports = { up, down };
