'use strict';

/**
 * Withdrawal controls (owner, 2026-11-24) — Admin → Transactions → Withdraw → "Withdrawal limits".
 *
 * `withdraw_controls`: the site's rule per currency.
 *   auto_limit    a crypto request BELOW it is sent through CCPayment at once, with no staff
 *                 step. At or above it, it waits in the queue for staff (transaction password).
 *                 NULL = auto-send off.
 *   daily_count   how many withdrawals a player may make in a rolling 24 hours (crypto + fiat).
 *   daily_amount  how much a player may withdraw in a rolling 24 hours.
 *   max_single    the largest single withdrawal.
 *
 * `player_withdraw_limits`: one player's override per currency. A non-NULL value replaces the
 * site's, and NULL falls back to it. `auto_allowed = false` makes every request of that player
 * wait for staff.
 *
 * `withdrawals.auto_sent`: the request was handed to CCPayment by the auto limit, not by staff.
 *
 * Empty tables = everything off: nothing changes on a live site until staff set a value.
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q(`CREATE TABLE IF NOT EXISTS withdraw_controls (
       currency      VARCHAR(12) PRIMARY KEY,
       auto_limit    NUMERIC(30, 8),
       daily_count   INTEGER,
       daily_amount  NUMERIC(30, 8),
       max_single    NUMERIC(30, 8),
       updated_by    BIGINT,
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
     )`);
  await q(`CREATE TABLE IF NOT EXISTS player_withdraw_limits (
       user_id       BIGINT      NOT NULL,
       currency      VARCHAR(12) NOT NULL,
       daily_count   INTEGER,
       daily_amount  NUMERIC(30, 8),
       max_single    NUMERIC(30, 8),
       auto_allowed  BOOLEAN     NOT NULL DEFAULT TRUE,
       note          VARCHAR(200),
       updated_by    BIGINT,
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
       PRIMARY KEY (user_id, currency)
     )`);
  await q('ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS auto_sent BOOLEAN NOT NULL DEFAULT FALSE');
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('ALTER TABLE withdrawals DROP COLUMN IF EXISTS auto_sent');
  await q('DROP TABLE IF EXISTS player_withdraw_limits');
  await q('DROP TABLE IF EXISTS withdraw_controls');
}

module.exports = { up, down };
