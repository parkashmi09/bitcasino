'use strict';

/**
 * Tip send idempotency. The client sends one `requestId` (uuid) per tip it means to send; a
 * retried request (network drop, proxy replay after a timeout) carries the same id and must
 * not move the money twice. Unique per sender, so two players can never collide; NULL for
 * tips sent before this (and for callers that send none), which a unique index allows.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE tips ADD COLUMN IF NOT EXISTS request_id UUID NULL', { transaction });
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_tips_sender_request ON tips (from_user_id, request_id) WHERE request_id IS NOT NULL',
    { transaction }
  );
  logger?.info('tips.request_id added (unique per sender)');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS uq_tips_sender_request', { transaction });
  await sequelize.query('ALTER TABLE tips DROP COLUMN IF EXISTS request_id', { transaction });
}

module.exports = { up, down };
