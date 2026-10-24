'use strict';

/**
 * `staff.must_change_password` — the session gate for a password somebody
 * else chose.
 *
 * Set when an account is created by another staff member (they typed its
 * temporary password) and when a superior resets it. Cleared when the owner
 * changes it themselves. While it is true, every admin API answers
 * 403 PASSWORD_CHANGE_REQUIRED except "who am I", change-password and logout.
 *
 * ── WHY NOT `first_login` ────────────────────────────────────────────────
 * `staff.first_login` already exists, but the baseline defaults it to TRUE and
 * legacy never reliably cleared it: on a restored or seeded database almost
 * every account — the owner included — still reads `true`. Enforcing it would
 * lock the whole staff out on deploy. A new column defaulting to FALSE gates
 * only the accounts this code marks from now on.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE staff ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`,
    { transaction }
  );
  logger?.info('Added staff.must_change_password');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE staff DROP COLUMN IF EXISTS must_change_password`, { transaction });
}

module.exports = { up, down };
