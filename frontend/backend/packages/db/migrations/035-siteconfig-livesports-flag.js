'use strict';

/**
 * `siteconfig.home_livesports` — the home page's live-sports strip.
 *
 * The admin panel's feature-flag screen lists twenty-two toggles
 * (`adminpanel/src/constants/booleanKeys.ts`, which states it "mirrors backend
 * siteconfig/migration.js → SITECONFIG_COLUMNS exactly"). Twenty-one of them
 * are columns on `siteconfig`. This one never was.
 *
 * So the screen has always rendered a switch for a setting with nowhere to go.
 * Under legacy that was worse than a no-op: `updateGlobal` built its SET clause
 * from the request body, so saving the form sent
 *
 *     UPDATE siteconfig SET "home_livesports"=$1, …
 *
 * and Postgres refused the whole statement with `column "home_livesports" of
 * relation "siteconfig" does not exist` — taking every other flag on the form
 * down with it. The screen could not save at all.
 *
 * `GET/PUT /api/v1/admin/site-config/global` allow-lists its columns rather
 * than trusting the body, so the missing column would instead be silently
 * dropped and the toggle would spring back on reload. Adding it is the honest
 * fix: the flag exists in the product, it should exist in the table.
 *
 * DEFAULT true, matching every other home-page section and matching how
 * `globalSettings()` reports an absent row — a deployment that has not
 * configured itself is not one that switched a section off.
 *
 * NOT NULL, because a third state is a question nothing asks: a null would
 * read as off in one branch and on in another.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  const [existing] = await sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'siteconfig'
        AND column_name = 'home_livesports'`,
    { transaction, type: QueryTypes.SELECT }
  );

  if (existing) {
    logger?.info('siteconfig.home_livesports already present — nothing to do');
    return;
  }

  await sequelize.query(
    `ALTER TABLE siteconfig
       ADD COLUMN home_livesports boolean DEFAULT true NOT NULL`,
    { transaction }
  );

  logger?.info(
    'Added siteconfig.home_livesports — the one flag on the admin toggle screen with no column behind it'
  );
}

/**
 * No `down()`.
 *
 * Dropping it puts back a toggle that cannot be saved. Reversing a migration
 * should not be a way to reintroduce a bug — see 034.
 */
module.exports = { up };
