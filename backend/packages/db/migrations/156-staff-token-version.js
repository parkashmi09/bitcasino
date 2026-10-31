'use strict';

/**
 * `staff.token_version` — lets a staff session be ended before its 8 h expiry.
 *
 * Staff tokens are stateless. The version is signed into each token (`tv`) and
 * the auth guard, which already re-reads the staff row on every request,
 * refuses a token whose version no longer matches. Logout, a password change
 * or reset, and a 2FA change bump it, so a stolen token dies with them.
 * DEFAULT 0 matches tokens issued before this column existed (no `tv` = 0).
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE staff ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`,
    { transaction }
  );
  logger?.info('Added staff.token_version');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE staff DROP COLUMN IF EXISTS token_version`, { transaction });
}

module.exports = { up, down };
