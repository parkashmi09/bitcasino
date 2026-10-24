'use strict';

/**
 * `sportsbook_sessions` — a launched third-party sportsbook session.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS TABLE HAS TO EXIST
 *
 * `legacy/sportsbook/controller.js` mints a session id and throws it away:
 *
 *     const session_id = uuid();
 *     ...
 *     res.json({ success: true, url: ..., session_id, token: ... });
 *
 * Nothing is stored. Which means the two endpoints that operate on a session
 * cannot know whose it is:
 *
 *   POST /sportsbooks/logout        takes `token` from the body and ends
 *                                   whatever session it names. Any token,
 *                                   anyone's session.
 *
 *   POST /sportsbooks/refresh-token takes `sportsbook_uuid`, `player_id` and
 *                                   `currency` from the body and opens a NEW
 *                                   real-money session on that player. It is
 *                                   `init` wearing a different name — the
 *                                   "refresh" reads no existing session because
 *                                   there is nothing to read.
 *
 * With a row, both become what they are named: look the session up, check it
 * belongs to the caller, then act. That is the whole reason for the table.
 *
 * It is also the only record that a player was sent to a third-party book at
 * all. The module is never mounted in legacy, so no such record has ever
 * existed — there is no backfill and nothing to migrate.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS sportsbook_sessions (
       id               BIGSERIAL PRIMARY KEY,
       -- The id WE generate and send to the provider. Not the provider's token.
       session_id       UUID         NOT NULL,
       user_id          BIGINT       NOT NULL,
       -- Which book. The provider lists them; a session belongs to exactly one.
       sportsbook_uuid  VARCHAR(64)  NOT NULL,
       -- The provider's token for this session, returned by init. Nullable
       -- because a provider may answer with a URL and no token.
       token            TEXT,
       -- The launch URL, kept so a reconnect does not need a second init. It
       -- carries the token in a query parameter on some books, which is why it
       -- is never returned to anyone but the session's owner.
       launch_url       TEXT,
       currency         VARCHAR(20)  NOT NULL,
       language         VARCHAR(10),
       -- open | closed. A closed session cannot be refreshed or reused.
       status           VARCHAR(20)  NOT NULL DEFAULT 'open',
       ip_address       VARCHAR(64),
       created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
       updated_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
       closed_at        TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * The session id is the lookup key for logout and refresh, and it must
   * resolve to exactly one row — otherwise "whose session is this" has more
   * than one answer.
   */
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_sportsbook_sessions_session ON sportsbook_sessions (session_id)',
    { transaction }
  );

  /** "This player's sessions", for the history endpoint and for support. */
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS ix_sportsbook_sessions_user ON sportsbook_sessions (user_id, created_at DESC)',
    { transaction }
  );

  /**
   * One open session per player per book.
   *
   * A partial index, so closed sessions accumulate freely — the constraint is
   * about what is live, not about history. Without it, a client that retries
   * `init` opens a second real-money session while the first is still running,
   * and a logout closes only one of them.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_sportsbook_sessions_open
       ON sportsbook_sessions (user_id, sportsbook_uuid)
       WHERE status = 'open'`,
    { transaction }
  );

  logger?.info('sportsbook_sessions created');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS sportsbook_sessions', { transaction });
}

module.exports = { up, down };
