'use strict';

/**
 * `withdrawals` — recording who decided, when, and what was actually sent.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE TABLE HAS NOWHERE TO PUT A TRANSACTION HASH
 *
 * Its columns are `uid, date, amount, wallet, status, coin, id, chain`. A
 * crypto withdrawal is settled by broadcasting a transaction, and the hash of
 * that transaction is the only proof it happened — it is what a player quotes
 * when they say the coin never arrived, and what an auditor follows to confirm
 * it did. There was no column for it.
 *
 * The intent was clearly there. `legacy/Users/Rule.js` builds the insert like
 * this:
 *
 *     let txid = "In Queue";
 *     pg.query("INSERT INTO withdrawals(uid, amount, wallet, status, coin, chain)
 *               VALUES($1,$2,$3,$4,$5,$6)", [id, fullAmount, wallet, txid, coin, chain])
 *
 * A variable named `txid` holding the string `"In Queue"`, passed into the
 * `status` position. Somebody meant to keep a transaction id and the column it
 * belonged in never existed, so the name survived on a variable that carries a
 * status.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * AND NO RECORD OF WHO APPROVED A PAYOUT
 *
 * `POST /updateWithdrawStatus` was `UPDATE withdrawals SET status = $1 WHERE
 * id = $2`, unauthenticated. It did write an activity row, but it took the
 * actor from an `x-staff-id` REQUEST HEADER — a value the caller sets. So the
 * only record of who authorised a payout was whatever the caller typed.
 *
 * `decided_by` is written from a verified staff token. On rows that predate
 * this it stays null, which is the honest answer: nobody knows.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE withdrawals
       ADD COLUMN IF NOT EXISTS txid       VARCHAR(120),
       ADD COLUMN IF NOT EXISTS decided_by BIGINT,
       ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS note       TEXT`,
    { transaction }
  );

  /**
   * One withdrawal per on-chain transaction.
   *
   * Partial, because the overwhelming majority of rows have no hash — pending
   * ones never will and historical ones never got one. Where a hash IS
   * recorded, it must belong to exactly one withdrawal: the same hash on two
   * rows means one broadcast was credited as settling two requests, which is
   * how a payout gets marked done without the coin ever being sent.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_withdrawals_txid
       ON withdrawals (txid)
     WHERE txid IS NOT NULL`,
    { transaction }
  );

  // The queue is read by status, newest first, on every review screen.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals (status, id DESC)',
    { transaction }
  );

  // And per player, for their own history.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_withdrawals_uid ON withdrawals (uid, id DESC)',
    { transaction }
  );

  logger?.info('withdrawals can now record a transaction hash and who authorised the payout');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Reverting discards every recorded transaction hash and every record of which ' +
        'staff member authorised a payout. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true ' +
        'if intended.'
    );
  }

  await sequelize.query('DROP INDEX IF EXISTS uq_withdrawals_txid', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_withdrawals_status', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_withdrawals_uid', { transaction });
  await sequelize.query(
    `ALTER TABLE withdrawals
       DROP COLUMN IF EXISTS txid,
       DROP COLUMN IF EXISTS decided_by,
       DROP COLUMN IF EXISTS decided_at,
       DROP COLUMN IF EXISTS note`,
    { transaction }
  );

  logger?.warn('Dropped the withdrawal decision columns');
}

module.exports = { up, down };
