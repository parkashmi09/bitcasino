'use strict';

/**
 * Club banners, notifications, and the push tokens they are delivered to.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * SIX MORE TABLES REFERENCED BY LIVE ROUTES AND NEVER CREATED
 *
 *   club_banners                     club_notifications
 *   club_banner_notifications        club_notification_status
 *   club_banner_notification_status  user_fcm_tokens
 *
 * Twelve mounted routes read and write these. None of the tables is in the
 * baseline schema and no migration has ever created one, so every banner
 * upload, every notification send, and every read receipt has returned 500
 * since the day it was written.
 *
 * This is the same finding as `club_memberships` in migration 014 — the club
 * feature as a whole has never worked. The shapes below are RECONSTRUCTED from
 * the statements that failed against them.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * TWO THINGS THE RECONSTRUCTION FIXES RATHER THAN COPIES
 *
 * A DELIVERY ROW PER MEMBER PER NOTIFICATION, WITH A KEY. The legacy sender
 * looped over members and inserted a status row per member with no constraint:
 *
 *     for (const member of members) {
 *       INSERT INTO club_notification_status (notification_id, user_id, is_sent, sent_at)
 *
 * Re-sending a notification — which the route allows — inserted a second row
 * per member, and `mark as read` then updated whichever one it found. The
 * unique key makes a resend an upsert.
 *
 * `is_read` HAD NO TIMESTAMP. "Read" was a boolean, so the only question a
 * support agent can actually ask — when did they see it — had no answer.
 */

async function up({ sequelize, transaction, logger }) {
  // ══════════════════════════════════════════════════════════════════════
  //  Push tokens
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_fcm_tokens (
       id         BIGSERIAL PRIMARY KEY,
       user_id    BIGINT       NOT NULL,
       token      TEXT         NOT NULL,
       platform   VARCHAR(20),
       -- A device that uninstalled the app keeps its row so the history of
       -- what was delivered stays intact; it just stops receiving.
       is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  // One row per device token. The same token registering twice is the same
  // device, not two.
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_user_fcm_token ON user_fcm_tokens (token)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_fcm_user ON user_fcm_tokens (user_id) WHERE is_active',
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  Banners
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS club_banners (
       id         BIGSERIAL PRIMARY KEY,
       club_id    BIGINT       NOT NULL,
       title      VARCHAR(200) NOT NULL,
       -- Stored as "<unique_club_id>/<filename>", relative to the banner
       -- storage root. NEVER an absolute path — see the module note on the
       -- banner-image route, which was a path traversal.
       image_path TEXT         NOT NULL,
       is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
       created_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_club_banners_club ON club_banners (club_id, created_at DESC)',
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  Notifications — free-standing, and banner-linked
  // ══════════════════════════════════════════════════════════════════════
  const notificationColumns = `
       id              BIGSERIAL PRIMARY KEY,
       club_id         BIGINT       NOT NULL,
       sender_id       BIGINT       NOT NULL,
       title           VARCHAR(200) NOT NULL,
       body            TEXT,
       type            VARCHAR(40)  NOT NULL DEFAULT 'general',
       additional_data JSONB,
       created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP`;

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS club_notifications (${notificationColumns})`,
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS club_banner_notifications (
       ${notificationColumns},
       banner_id BIGINT NOT NULL
     )`,
    { transaction }
  );

  for (const table of ['club_notifications', 'club_banner_notifications']) {
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_${table}_club ON ${table} (club_id, created_at DESC)`,
      { transaction }
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Delivery and read state
  // ══════════════════════════════════════════════════════════════════════
  const statusColumns = `
       id              BIGSERIAL PRIMARY KEY,
       notification_id BIGINT      NOT NULL,
       user_id         BIGINT      NOT NULL,
       is_sent         BOOLEAN     NOT NULL DEFAULT FALSE,
       sent_at         TIMESTAMPTZ,
       is_read         BOOLEAN     NOT NULL DEFAULT FALSE,
       -- WHEN it was read, not just that it was. Legacy stored only the
       -- boolean, so the one question worth asking had no answer.
       read_at         TIMESTAMPTZ,
       created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`;

  for (const table of ['club_notification_status', 'club_banner_notification_status']) {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS ${table} (${statusColumns})`, { transaction });

    /**
     * ONE delivery row per member per notification.
     *
     * The legacy sender looped and inserted with no constraint, so re-sending
     * a notification produced a second row per member and "mark as read" then
     * updated whichever one it happened to find. With this, a resend is an
     * upsert and the read state survives it.
     */
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_${table} ON ${table} (notification_id, user_id)`,
      { transaction }
    );

    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_${table}_unread ON ${table} (user_id) WHERE NOT is_read`,
      { transaction }
    );
  }

  logger?.info(
    'Created the club broadcast schema — 6 tables that 12 mounted routes referenced and that never existed'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping these discards every club banner, notification and read receipt. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }

  for (const table of [
    'club_banner_notification_status',
    'club_notification_status',
    'club_banner_notifications',
    'club_notifications',
    'club_banners',
    'user_fcm_tokens',
  ]) {
    await sequelize.query(`DROP TABLE IF EXISTS ${table}`, { transaction });
  }

  logger?.warn('Dropped the club broadcast schema');
}

module.exports = { up, down };
