'use strict';

/**
 * `user_notifications.send_id` + `sent_by` — one staff send (a broadcast or a one-user push) groups
 * its inbox rows under one id, so the admin's Sent list can show, edit and delete it as one item.
 * Nullable: player event notifications and older sends have neither.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS send_id UUID', { transaction });
  await sequelize.query('ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS sent_by BIGINT', { transaction });
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_notifications_send_id ON user_notifications (send_id) WHERE send_id IS NOT NULL',
    { transaction }
  );
  logger?.info('Added user_notifications.send_id / sent_by — staff sends are listable');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_user_notifications_send_id', { transaction });
  await sequelize.query('ALTER TABLE user_notifications DROP COLUMN IF EXISTS sent_by', { transaction });
  await sequelize.query('ALTER TABLE user_notifications DROP COLUMN IF EXISTS send_id', { transaction });
}

module.exports = { up, down };
