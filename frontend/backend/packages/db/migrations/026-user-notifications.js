'use strict';

/**
 * `user_notifications` — the push notification history.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE FOURTH TABLE IN THIS PORT THAT LIVE ROUTES REFERENCE AND NOBODY CREATED
 *
 * `legacy/firabsenotifcation/controller.js` reads and writes
 * `user_notifications` in five places, behind five mounted routes:
 *
 *     POST /firebase/send-to-user      POST /firebase/send-bulk
 *     GET  /firebase/unread-count/:id  POST /firebase/mark-as-read
 *     GET  /firebase/history/:id
 *
 * It is not in the baseline schema and no migration has ever created it, so
 * every one of those five has returned "relation does not exist" since it was
 * written. `user_fcm_tokens` — the companion table — was created by migration
 * 019 for the club broadcasts; this is the other half.
 *
 * After `club_memberships` (014), the six club broadcast tables (019) and
 * `admin_fancy_control` (024). The column list below is taken directly from the
 * INSERT that has been failing against it:
 *
 *     INSERT INTO user_notifications (user_id, title, body, type, additional_data)
 *
 * plus `is_read` and `created_at`, which the reads name.
 *
 * ── WHAT THE RECONSTRUCTION ADDS ─────────────────────────────────────────
 *
 * `read_at`. `getUnreadCount` filters on `is_read = false` and `markAsRead`
 * sets it true, so "read" was a boolean with no timestamp — the one question a
 * support agent asks, when did they see it, had no answer. Same omission as the
 * club notification status tables, and fixed the same way.
 *
 * `delivered` and `delivery_error`. A push either reached the device or it did
 * not, and legacy recorded only that a row was written. Without them a player
 * saying "I never got it" cannot be answered.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS user_notifications (
       id              BIGSERIAL PRIMARY KEY,
       user_id         BIGINT       NOT NULL,
       title           VARCHAR(200) NOT NULL,
       body            TEXT,
       type            VARCHAR(40)  NOT NULL DEFAULT 'general',
       -- The payload the app routes on: which screen to open, which match.
       additional_data JSONB,
       is_read         BOOLEAN      NOT NULL DEFAULT FALSE,
       -- WHEN, not just whether. Legacy stored only the boolean.
       read_at         TIMESTAMPTZ,
       -- Whether the push actually reached a device, and why not.
       delivered       BOOLEAN      NOT NULL DEFAULT FALSE,
       delivery_error  TEXT,
       created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  // "My notifications, newest first" — the only read a player makes.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications (user_id, created_at DESC)',
    { transaction }
  );

  /**
   * The unread badge.
   *
   * Partial, because unread is the small side and the count is asked for on
   * every app open — the whole index fits in memory where the full one would
   * not.
   */
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications (user_id) WHERE NOT is_read',
    { transaction }
  );

  logger?.info(
    'Created user_notifications — the table five mounted routes have been failing against since they were written'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every notification ever sent and every read receipt. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS user_notifications', { transaction });
  logger?.warn('Dropped user_notifications');
}

module.exports = { up, down };
