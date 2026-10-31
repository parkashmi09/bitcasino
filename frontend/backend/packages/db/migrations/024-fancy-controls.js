'use strict';

/**
 * `admin_fancy_control` — which fancy markets a player is allowed to see.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ANOTHER TABLE FIVE MOUNTED ROUTES REFERENCE AND NOBODY CREATED
 *
 *     GET    /sports/admin/fancy-controls
 *     GET    /sports/admin/fancy-controls/:eventId
 *     POST   /sports/admin/update-fancy-status
 *     POST   /sports/admin/bulk-update-fancy-status
 *     DELETE /sports/admin/fancy-control/:marketId
 *
 * `sportsApiAdminFancyController.js` reads and writes `admin_fancy_control`
 * seven times. The table is not in the baseline schema and no migration has
 * ever created it, so every one of those five endpoints has returned
 * "relation does not exist" since the day it was written — which means the
 * fancy visibility controls have never worked, and every fancy market the feed
 * returns has been shown.
 *
 * Third occurrence of this exact pattern: `club_memberships` (migration 014),
 * the six club broadcast tables (019), and now this. The shape below is
 * RECONSTRUCTED from the statements that failed against it — in this case
 * directly, because the upsert names its own conflict target:
 *
 *     INSERT INTO admin_fancy_control
 *       (event_id, event_name, market_id, market_name, show_fancy, created_at)
 *     VALUES ($1,$2,$3,$4,$5,NOW())
 *     ON CONFLICT (market_id) DO UPDATE SET ...
 *
 * ── WHY THIS ONE MATTERS MORE THAN A BROKEN SCREEN ───────────────────────
 *
 * A fancy control decides whether a market is open to bet on. With the table
 * missing, the answer has effectively been "always open" — including for
 * markets an operator tried to close. The endpoints that would have closed one
 * returned a 500 and the market stayed live.
 *
 * ── WHAT THE RECONSTRUCTION ADDS ─────────────────────────────────────────
 *
 * `updated_at`. Legacy's upsert set `created_at = NOW()` on the UPDATE branch,
 * so re-closing a market overwrote when the control was first created and
 * there was no way to ask when it last changed. Both columns exist here and
 * each means what its name says.
 *
 * `updated_by`. Closing a fancy market moves the book. Legacy recorded nothing
 * about who did it — the routes had no authentication at all, only a
 * middleware that checks whether sports are globally switched on.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS admin_fancy_control (
       id          BIGSERIAL PRIMARY KEY,
       -- Provider ids, kept as text. The upstream feed sends them as strings
       -- and the legacy controller does String(...).trim() on both before use.
       event_id    VARCHAR(64)  NOT NULL,
       event_name  VARCHAR(255),
       market_id   VARCHAR(64)  NOT NULL,
       market_name VARCHAR(255),
       -- TRUE means players may see and bet this fancy market.
       show_fancy  BOOLEAN      NOT NULL DEFAULT TRUE,
       -- Who closed or reopened it. Null on rows written before staff tokens
       -- reached these routes, which is all of them.
       updated_by  BIGINT,
       created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * One control per market — the conflict target legacy's upsert already names.
   *
   * Without it the `ON CONFLICT (market_id)` clause is a syntax error against
   * the table, so even with the table present the upsert would not run.
   */
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_fancy_control_market ON admin_fancy_control (market_id)',
    { transaction }
  );

  // The per-event listing is the screen an operator actually uses.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_admin_fancy_control_event ON admin_fancy_control (event_id)',
    { transaction }
  );

  // "What is currently hidden" — the question worth answering quickly, and the
  // smaller side of the index.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_admin_fancy_control_hidden ON admin_fancy_control (event_id) WHERE NOT show_fancy',
    { transaction }
  );

  logger?.info(
    'Created admin_fancy_control — the table five mounted routes have been failing against since they were written'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every fancy market visibility decision, which reopens ' +
        'markets an operator closed. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }

  await sequelize.query('DROP TABLE IF EXISTS admin_fancy_control', { transaction });
  logger?.warn('Dropped admin_fancy_control — every closed fancy market is now open again');
}

module.exports = { up, down };
