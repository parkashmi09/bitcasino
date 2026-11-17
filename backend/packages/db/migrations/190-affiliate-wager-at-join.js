'use strict';

/**
 * Security (B4): record a member's cumulative wager at the moment they join a referrer's team, so
 * tier unlocks count only wager made AFTER joining. Without it, a player with large pre-existing
 * wager could join a code and instantly unlock every tier for the referrer (collusion payout).
 * Nullable; existing team rows keep NULL and are treated as a zero baseline (grandfathered).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE team ADD COLUMN IF NOT EXISTS wager_at_join TEXT', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE team DROP COLUMN IF EXISTS wager_at_join', { transaction });
}

module.exports = { up, down };
