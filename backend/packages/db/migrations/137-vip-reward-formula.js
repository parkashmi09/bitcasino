'use strict';

/**
 * hash.game's rakeback and recurring bonuses (/bonus, the info button on each card):
 *
 *   Instant     Wagered × house edge × 10%                       real time
 *   Daily       Wagered × house edge × 4%                        00:00–23:59 UTC, paid next day
 *   Weekly      Wagered × house edge × 4% + net loss × 1%         Fri–Thu UTC, paid Friday
 *   Monthly     Wagered × house edge × 3.5% + net loss × 1.5%     15th–14th UTC, paid the 15th
 *
 * `mode` 'hash' uses these (percents below, edited in the site admin); 'fixed' keeps the old
 * per-card amounts and rates (vipRewards.js).
 */
const FORMULA = JSON.stringify({
  mode: 'hash',
  instant: '10',
  daily: '4',
  weeklyWager: '4',
  weeklyLoss: '1',
  monthlyWager: '3.5',
  monthlyLoss: '1.5',
});

async function up({ sequelize, transaction }) {
  await sequelize.query(`ALTER TABLE siteconfig ADD COLUMN IF NOT EXISTS vip_reward_formula JSONB NOT NULL DEFAULT '${FORMULA}'::jsonb`, { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE siteconfig DROP COLUMN IF EXISTS vip_reward_formula', { transaction });
}

module.exports = { up, down };
