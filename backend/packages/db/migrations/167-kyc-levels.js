'use strict';

/**
 * rainbet: KYC Levels 3 and 4 — proof of address and source of income (the player site's
 * Settings → Verification). One row per player per level, replaced when a rejected level is sent
 * again. Level 3 opens once the identity KYC (`user_kyc`, Levels 1–2) is Verified, Level 4 once
 * Level 3 is. The document is stored like a KYC document (same directory, random name, sniffed
 * type) and read back only by its owner or by staff.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_kyc_levels (
       id               BIGSERIAL    PRIMARY KEY,
       user_id          BIGINT       NOT NULL,
       -- 3 = proof of address, 4 = source of income
       level            SMALLINT     NOT NULL,
       document_path    VARCHAR(200) NOT NULL,
       -- Pending | Verified | Rejected
       status           VARCHAR(10)  NOT NULL DEFAULT 'Pending',
       rejection_reason VARCHAR(500),
       reviewed_by      BIGINT,
       created_at       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       reviewed_at      TIMESTAMPTZ
     )`,
    { transaction }
  );
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS user_kyc_levels_once ON user_kyc_levels (user_id, level)`, { transaction });
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_user_kyc_levels_status ON user_kyc_levels (status, created_at)`, { transaction });
  logger?.info('Created user_kyc_levels');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error('Dropping this discards every Level 3/4 verification. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.');
  }
  await sequelize.query('DROP TABLE IF EXISTS user_kyc_levels', { transaction });
  logger?.warn('Dropped user_kyc_levels');
}

module.exports = { up, down };
