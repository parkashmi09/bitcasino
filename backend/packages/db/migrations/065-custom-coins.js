'use strict';

/**
 * Custom coins (coin management, phase B): balances for coins the platform
 * owner creates, and the owner's fixed USD rate.
 *
 *   wallet_balances (uid, currency) → balance
 *       One row per player and CUSTOM coin. A built-in coin keeps its
 *       `credits.<code>` column; a coin the owner adds through the owner panel
 *       has no column, so its balance lives here. `currency` references
 *       `currencies(code)` — a balance can only exist for a coin the registry
 *       knows, and a coin with balances cannot be deleted (the owner panel only
 *       disables). `balance >= 0` is a CHECK, a second line behind the wallet's
 *       guarded `UPDATE … WHERE balance >= :amount`.
 *
 *   currencies.usd_rate   NUMERIC(24,8), NULL for built-in coins
 *       The owner's fixed USD value of one unit. Applied from the entitlement
 *       document by admin-service, which also writes it to `exchangerate` so
 *       swap and convert price the coin like any other.
 *
 *   exchangerate.managed_by   VARCHAR(20)
 *       'owner' on a rate the owner panel sets: the site admin's rate editor
 *       refuses to change or delete those rows (EXCHANGE_RATE_OWNER_MANAGED).
 *
 * Idempotent (IF NOT EXISTS everywhere). `down` drops the table and the two
 * columns — only safe while no custom coin holds a balance.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS wallet_balances (
       uid         BIGINT         NOT NULL,
       currency    VARCHAR(10)    NOT NULL REFERENCES currencies(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
       balance     NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (balance >= 0),
       created_at  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (uid, currency)
     )`,
    { transaction }
  );
  await sequelize.query('CREATE INDEX IF NOT EXISTS wallet_balances_currency_idx ON wallet_balances (currency)', { transaction });
  await sequelize.query('ALTER TABLE currencies ADD COLUMN IF NOT EXISTS usd_rate NUMERIC(24,8)', { transaction });
  await sequelize.query('ALTER TABLE exchangerate ADD COLUMN IF NOT EXISTS managed_by VARCHAR(20)', { transaction });
  logger?.info('wallet_balances, currencies.usd_rate and exchangerate.managed_by present');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP TABLE IF EXISTS wallet_balances', { transaction });
  await sequelize.query('ALTER TABLE currencies DROP COLUMN IF EXISTS usd_rate', { transaction });
  await sequelize.query('ALTER TABLE exchangerate DROP COLUMN IF EXISTS managed_by', { transaction });
  logger?.warn('Dropped wallet_balances (custom coin balances are gone), currencies.usd_rate, exchangerate.managed_by');
}

module.exports = { up, down };
