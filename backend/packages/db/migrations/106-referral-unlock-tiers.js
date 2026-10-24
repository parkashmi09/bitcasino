'use strict';

/**
 * Referral unlock tiers — the "Friend's Level / Total Wager / Unlock Amount"
 * table the player site prints on `/referral/rules`, on `siteconfig` next to
 * the welcome bonus settings (migration 070) and the tip limits (081): a
 * platform setting the site admin edits (`GET/PUT /admin/site-config/
 * referral-unlocks`) and every browser reads (`GET /admin/site-config/public`
 * → `referralUnlocks`).
 *
 *   referral_unlock_tiers  jsonb list of
 *                          { level, totalWager, unlockAmount }
 *                          level        the friend's VIP level NAME as the site prints it ("Bronze I")
 *                          totalWager   the friend's total wager that reaches it (decimal string)
 *                          unlockAmount what the referrer unlocks there, in the reward currency
 *
 * THE COLUMN DEFAULT IS THE TABLE THE SITE SHOWED BEFORE THIS EXISTED (the
 * bc.game capture, ten rows), so a site that never opens the screen renders
 * exactly what it rendered before. The service shares the same defaults when
 * the column is absent, so deploying the code before running this is safe.
 */

const COLUMN = 'referral_unlock_tiers';

const DEFAULT_TIERS = [
  { level: 'Bronze I', totalWager: '1000', unlockAmount: '0.50' },
  { level: 'Bronze II', totalWager: '3000', unlockAmount: '2.50' },
  { level: 'Bronze IV', totalWager: '15000', unlockAmount: '5.00' },
  { level: 'Silver I', totalWager: '30000', unlockAmount: '12.00' },
  { level: 'Silver III', totalWager: '120000', unlockAmount: '25.00' },
  { level: 'Silver IV', totalWager: '240000', unlockAmount: '50.00' },
  { level: 'Gold I', totalWager: '500000', unlockAmount: '80.00' },
  { level: 'Gold II', totalWager: '1000000', unlockAmount: '120.00' },
  { level: 'Gold IV', totalWager: '3500000', unlockAmount: '205.00' },
  { level: 'Platinum II', totalWager: '8500000', unlockAmount: '500.00' },
];

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  const [existing] = await sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'siteconfig'
        AND column_name = :column`,
    { transaction, type: QueryTypes.SELECT, replacements: { column: COLUMN } }
  );
  if (existing) {
    logger?.info(`siteconfig.${COLUMN} already present — nothing to do`);
    return;
  }

  // The JSON is ours (a constant above), never input; quoted for the DDL
  // because a column DEFAULT cannot take a bind parameter.
  const literal = JSON.stringify(DEFAULT_TIERS).replace(/'/g, "''");
  await sequelize.query(
    `ALTER TABLE siteconfig ADD COLUMN ${COLUMN} jsonb DEFAULT '${literal}'::jsonb NOT NULL`,
    { transaction }
  );
  logger?.info(`Added siteconfig.${COLUMN} (seeded with the ${DEFAULT_TIERS.length} captured rows)`);
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query(`ALTER TABLE siteconfig DROP COLUMN IF EXISTS ${COLUMN}`, { transaction });
  logger?.warn(`Dropped siteconfig.${COLUMN}`);
}

module.exports = { up, down, DEFAULT_TIERS };
