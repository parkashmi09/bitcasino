'use strict';

/**
 * Withdrawal whitelist cool-offs (migration 043's table and switch).
 *
 *   user_withdrawal_whitelist.active_at   a new address is usable from here: added + 24 h, so a
 *                                         hijacked session cannot add its own address and withdraw.
 *   users.withdraw_whitelist_off_at       a pending "turn enforcement off": it takes effect at
 *                                         this time, and turning it back on clears it.
 *
 * Existing addresses were saved before the rule; they count from their own created_at.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `ALTER TABLE user_withdrawal_whitelist ADD COLUMN IF NOT EXISTS active_at TIMESTAMPTZ`,
    { transaction }
  );
  await sequelize.query(
    `UPDATE user_withdrawal_whitelist SET active_at = created_at + INTERVAL '24 hours' WHERE active_at IS NULL`,
    { transaction }
  );
  await sequelize.query(
    `ALTER TABLE user_withdrawal_whitelist
       ALTER COLUMN active_at SET DEFAULT (NOW() + INTERVAL '24 hours'),
       ALTER COLUMN active_at SET NOT NULL`,
    { transaction }
  );
  await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS withdraw_whitelist_off_at TIMESTAMPTZ`, { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE users DROP COLUMN IF EXISTS withdraw_whitelist_off_at`, { transaction });
  await sequelize.query(`ALTER TABLE user_withdrawal_whitelist DROP COLUMN IF EXISTS active_at`, { transaction });
}

module.exports = { up, down };
