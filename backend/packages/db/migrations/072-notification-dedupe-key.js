'use strict';

/**
 * `user_notifications.dedupe_key` — one notification per event, however many
 * times the event is reported.
 *
 * Until now only staff broadcasts wrote this table. Player notifications for
 * money events (deposit approved, withdrawal paid, VIP level-up, …) are fired
 * from paths that can run twice for one event: a PSP retries its callback, a
 * wager hook replays, an admin double-clicks. The key names the event
 * (`fiat-deposit:approved:123`), and the partial unique index makes the second
 * insert a no-op instead of a second row in the player's bell.
 *
 * Nullable and partial, so broadcasts (no key) are unaffected.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(160)', {
    transaction,
  });
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notifications_dedupe
       ON user_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`,
    { transaction }
  );
  logger?.info('Added user_notifications.dedupe_key — player event notifications are idempotent');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS uq_user_notifications_dedupe', { transaction });
  await sequelize.query('ALTER TABLE user_notifications DROP COLUMN IF EXISTS dedupe_key', { transaction });
}

module.exports = { up, down };
