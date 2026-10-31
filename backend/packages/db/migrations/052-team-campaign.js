'use strict';

/** Optional campaign label on a referral team row (`?c=` on the share link). */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  const [existing] = await sequelize.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'team'
        AND column_name = 'campaign'`,
    { transaction, type: QueryTypes.SELECT }
  );

  if (existing) {
    logger?.info('team.campaign already present — nothing to do');
    return;
  }

  await sequelize.query(
    `ALTER TABLE team ADD COLUMN campaign text NOT NULL DEFAULT ''`,
    { transaction }
  );
  logger?.info('Added team.campaign');
}

module.exports = { up };
