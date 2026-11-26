'use strict';

/**
 * `users.must_change_password` — an agent's player (B2B) replaces the password somebody else chose.
 *
 * Set when a staff member creates the player (they typed its password) and when one resets it.
 * Cleared when the player changes it themselves. While it is true the player site shows the
 * change-password dialog and every player write answers 403 PASSWORD_CHANGE_REQUIRED except
 * change-password and logout (`packages/auth` `authenticate`). The staff twin is migration 063.
 *
 * Agent players that have never signed in are marked here too, so their first sign-in asks for
 * it. Players that already signed in, direct sign-ups and demo accounts are left alone.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false',
    { transaction }
  );
  const [, result] = await sequelize.query(
    `UPDATE users SET must_change_password = true
      WHERE parent_staff_id IS NOT NULL AND last_login_at IS NULL AND COALESCE(is_demo, false) = false`,
    { transaction }
  );
  logger?.info({ marked: result?.rowCount ?? 0 }, 'Added users.must_change_password');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS must_change_password', { transaction });
}

module.exports = { up, down };
