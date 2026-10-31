'use strict';

/**
 * Admin → Users → Financial → Withdrawal: "Withdrawal limit" aur "Wagering bonus" (reference admin jaisa).
 *
 *   limit_enabled         deposit-multiple cap ON / OFF
 *   deposit_multiplier    player max itna × apne deposits nikal sakta hai (0.1 – 100)
 *   wager_bonus_enabled   wagering bonus ON / OFF (cap ke upar, bet jitna, max wager_multiplier × deposits)
 *   wager_multiplier      bonus ki upper limit (× deposits)
 *
 * NULL = admin ne abhi save nahi kiya → owner panel ki setting chalti hai
 * (\`withdrawalCap.readAdminWithdrawalCap\`). Idempotent.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS withdrawal_control (
       id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       withdrawals_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
       updated_by           BIGINT,
       updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query('INSERT INTO withdrawal_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING', { transaction });
  await sequelize.query(
    `ALTER TABLE withdrawal_control
       ADD COLUMN IF NOT EXISTS limit_enabled       BOOLEAN,
       ADD COLUMN IF NOT EXISTS deposit_multiplier  NUMERIC(6,2),
       ADD COLUMN IF NOT EXISTS wager_bonus_enabled BOOLEAN,
       ADD COLUMN IF NOT EXISTS wager_multiplier    NUMERIC(6,2),
       ADD COLUMN IF NOT EXISTS limit_updated_by    BIGINT,
       ADD COLUMN IF NOT EXISTS limit_updated_at    TIMESTAMPTZ`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query(
    `ALTER TABLE withdrawal_control
       DROP COLUMN IF EXISTS limit_enabled, DROP COLUMN IF EXISTS deposit_multiplier,
       DROP COLUMN IF EXISTS wager_bonus_enabled, DROP COLUMN IF EXISTS wager_multiplier,
       DROP COLUMN IF EXISTS limit_updated_by, DROP COLUMN IF EXISTS limit_updated_at`,
    { transaction }
  );
}

module.exports = { up, down };
