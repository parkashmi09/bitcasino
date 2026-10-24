'use strict';

/**
 * `user_bank_accounts` — the bank accounts and UPI ids a player has saved to
 * withdraw to, so the withdraw form is a pick rather than a retype.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY NOT `currency_payment_details` (the admin's /bank-details page)
 *
 * That table is the HOUSE's deposit destinations — where players are told to
 * send money. It has no user id and writing it is a staff action. A player's
 * payout account is the opposite direction and the opposite owner, and
 * putting both in one table is how a player's account ends up listed as the
 * place to send everyone's deposits. `p2p_payment_accounts` has no user id
 * either. Nothing on the platform held a player's own payout details.
 *
 * ── ONE ROW IS EITHER A BANK ACCOUNT OR A UPI ID ─────────────────────────
 *
 * `method` says which, and the CHECK says what each must carry: a bank row has
 * an account number and an IFSC, a UPI row has a UPI id. The withdraw form
 * has the same two routes, and a row that is half of each is not something
 * the player can pick.
 *
 * ── AT MOST ONE DEFAULT PER PLAYER, ENFORCED BY THE INDEX ────────────────
 *
 * A partial unique index on `(user_id) WHERE is_default`. The service clears
 * the old default and sets the new one in one transaction; the index is what
 * makes two concurrent "set default" calls unable to leave two.
 *
 * ── DUPLICATES REFUSED PER PLAYER ────────────────────────────────────────
 *
 * The same account number + IFSC, or the same UPI id (case-insensitive — UPI
 * handles are), saved twice is a mistake, not a second account.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_bank_accounts (
       id                  BIGSERIAL    PRIMARY KEY,
       user_id             BIGINT       NOT NULL,
       method              VARCHAR(10)  NOT NULL CHECK (method IN ('bank', 'upi')),
       account_holder_name VARCHAR(255) NOT NULL,
       bank_name           VARCHAR(255),
       account_number      VARCHAR(34),
       ifsc_code           VARCHAR(11),
       upi_id              VARCHAR(255),
       is_default          BOOLEAN      NOT NULL DEFAULT false,
       created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT user_bank_accounts_shape CHECK (
         (method = 'bank' AND account_number IS NOT NULL AND ifsc_code IS NOT NULL AND upi_id IS NULL)
         OR (method = 'upi' AND upi_id IS NOT NULL AND account_number IS NULL AND ifsc_code IS NULL)
       )
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS user_bank_accounts_bank_uniq
       ON user_bank_accounts (user_id, account_number, ifsc_code) WHERE method = 'bank'`,
    { transaction }
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS user_bank_accounts_upi_uniq
       ON user_bank_accounts (user_id, lower(upi_id)) WHERE method = 'upi'`,
    { transaction }
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS user_bank_accounts_one_default
       ON user_bank_accounts (user_id) WHERE is_default`,
    { transaction }
  );
  // "My accounts" — the only read there is.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_user_bank_accounts_user
       ON user_bank_accounts (user_id, created_at DESC)`,
    { transaction }
  );

  logger?.info('Created user_bank_accounts');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every payout account every player has saved. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS user_bank_accounts', { transaction });
  logger?.warn('Dropped user_bank_accounts');
}

module.exports = { up, down };
