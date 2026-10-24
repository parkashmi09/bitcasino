'use strict';

/**
 * `siteconfig.sports` — the platform-wide sports kill switch.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE COLUMN THREE ROUTES READ AND NOBODY CREATED
 *
 *     GET  /api/v1/admin/site-config/sports      the operator's toggle
 *     PUT  /api/v1/admin/site-config/sports      turning it off
 *     GET  /internal/admin/site-config/sports    what sports-service asks
 *
 * `SiteConfigService.sportsEnabled()` selects `['id', 'sports']` and
 * `setSportsEnabled()` writes it. The column is not in the baseline schema and
 * no migration has created it, so all three answered
 *
 *     column "sports" does not exist
 *
 * ── WHY IT MATTERS MORE THAN A BROKEN TOGGLE ─────────────────────────────
 *
 * sports-service asks the internal route in front of every feed endpoint —
 * that is what replaced legacy's `SELECT sports FROM siteconfig LIMIT 1` on
 * every request. The caller caches for a few seconds and FAILS OPEN when the
 * answer does not arrive, so the board keeps working; what does not work is
 * turning it off. An operator hitting the kill switch got a 500 and every
 * sports market stayed live.
 *
 * Fourth occurrence of this pattern in the port, after `club_memberships`
 * (migration 014), the club broadcast tables (019) and `admin_fancy_control`
 * (024). This one is a single column rather than a table, which is why it hid
 * longer: the screen that reads it is one toggle on a settings page.
 *
 * ── DEFAULT TRUE ─────────────────────────────────────────────────────────
 *
 * Matching `sportsEnabled()`, which already reports `true` for a missing row:
 * the board being up is the normal state, and an unconfigured deployment is
 * not the same thing as an operator switching sports off. Defaulting to false
 * would take every sports market down the moment this migration ran.
 *
 * NOT NULL, because a third state here is a question nothing asks — the flag is
 * on or off, and a null would read as off in one branch and on in another.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  const [existing] = await sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'siteconfig'
        AND column_name = 'sports'`,
    { transaction, type: QueryTypes.SELECT }
  );

  if (existing) {
    logger?.info('siteconfig.sports already present — nothing to do');
    return;
  }

  await sequelize.query(
    `ALTER TABLE siteconfig
       ADD COLUMN sports boolean DEFAULT true NOT NULL`,
    { transaction }
  );

  logger?.info(
    'Added siteconfig.sports — the kill switch three routes have been failing against since they were written'
  );
}

/**
 * No `down()`.
 *
 * Dropping it restores the defect: three mounted routes reading a column that
 * does not exist, and a kill switch that 500s instead of working. Reversing a
 * migration should not be a way to reintroduce a bug.
 */
module.exports = { up };
