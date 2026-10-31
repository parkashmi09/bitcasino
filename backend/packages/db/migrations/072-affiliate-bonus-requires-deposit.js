'use strict';

/**
 * `siteconfig.affiliate_bonus_requires_deposit` — the referrer's joining bonus
 * waits for the referee's first deposit.
 *
 * The joining bonus (`affiliatebonus`) used to be booked the moment a referee
 * signed up, so fake sign-ups farmed it. With this ON (the default) it is
 * booked only once the referee's deposit is credited — the same hook every
 * deposit path already calls for the first-deposit bonus. OFF keeps the old
 * sign-up behaviour for an operator who wants it.
 */
async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');
  const [exists] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'siteconfig' AND column_name = 'affiliate_bonus_requires_deposit'`,
    { transaction, type: QueryTypes.SELECT }
  );
  if (exists) return;
  await sequelize.query(
    'ALTER TABLE siteconfig ADD COLUMN affiliate_bonus_requires_deposit boolean DEFAULT true NOT NULL',
    { transaction }
  );
  logger?.info('Added siteconfig.affiliate_bonus_requires_deposit (default true)');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE siteconfig DROP COLUMN IF EXISTS affiliate_bonus_requires_deposit', { transaction });
}

module.exports = { up, down };
