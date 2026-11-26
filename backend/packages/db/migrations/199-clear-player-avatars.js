'use strict';

/**
 * Clear every player's chosen avatar (user, 2026-11-24).
 *
 * Avatars now sit behind a site-wide switch (`siteconfig.settings.avatars_enabled`, Admin →
 * Content → Avatars), off by default: the player site draws the first letter of the player's
 * name instead. Clearing `users.avatar` means that when an operator later turns avatars on,
 * every player starts from the default rather than a picture picked before the switch existed.
 * The catalogue (`avatars`, migration 115) is untouched.
 *
 * Runs on the parent and on every whitelabel copy (each has its own `users`).
 */
async function up({ sequelize, transaction, logger }) {
  const [, meta] = await sequelize.query(
    `UPDATE users SET avatar = NULL WHERE avatar IS NOT NULL AND avatar <> ''`,
    { transaction }
  );
  logger?.info(`Cleared users.avatar on ${meta?.rowCount ?? 0} account(s)`);
}

/** No `down()`: the cleared values are not kept anywhere. */
module.exports = { up };
