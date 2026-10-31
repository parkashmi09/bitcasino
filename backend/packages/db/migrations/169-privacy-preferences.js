'use strict';

/**
 * rainbet: the player site's Settings switches that only lived in the browser — Show Bets
 * Publicly, Display Statistics on Profile and Receive Tip Notifications — as `userconfig`
 * columns, all on by default (what a player who never touched them sees today).
 *
 *   show_bets_publicly  off: the name is hidden on the public race leaderboards
 *   show_statistics     off: the public profile shows no bets / wins / games played
 *   tip_notifications   off: no "you got a tip" notification (the tip itself still arrives)
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE userconfig
       ADD COLUMN IF NOT EXISTS show_bets_publicly BOOLEAN NOT NULL DEFAULT true,
       ADD COLUMN IF NOT EXISTS show_statistics BOOLEAN NOT NULL DEFAULT true,
       ADD COLUMN IF NOT EXISTS tip_notifications BOOLEAN NOT NULL DEFAULT true`,
    { transaction }
  );
  logger?.info('userconfig: show_bets_publicly, show_statistics, tip_notifications');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE userconfig
       DROP COLUMN IF EXISTS show_bets_publicly,
       DROP COLUMN IF EXISTS show_statistics,
       DROP COLUMN IF EXISTS tip_notifications`,
    { transaction }
  );
  logger?.warn('Dropped the userconfig privacy columns');
}

module.exports = { up, down };
