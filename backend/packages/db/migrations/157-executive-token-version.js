'use strict';

/**
 * `executives.token_version` — lets an executive's logout end its session.
 *
 * An executive token carries its parent's `staff.token_version` (`tv`), which
 * logout cannot bump without signing the parent out. So the executive's own
 * version is signed in too (`etv`), and the staff guard refuses a token whose
 * `etv` no longer matches. DEFAULT 0 matches tokens issued before (no `etv` = 0).
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE executives ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`,
    { transaction }
  );
  logger?.info('Added executives.token_version');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE executives DROP COLUMN IF EXISTS token_version`, { transaction });
}

module.exports = { up, down };
