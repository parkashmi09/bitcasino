'use strict';

/**
 * rainbet: which perks each VIP rank gets, set by the admin. `key` marks a default perk; the four
 * in vip.service.js (rakeback, daily, weekly, monthly) also decide the real payout. `cards` lists
 * the ladder cards that get the perk. Idempotent.
 */
const ALL = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'eternal'];
const DEFAULTS = [
  ['rakeback', 'Rakeback', ALL],
  ['daily', 'Daily Bonus', ALL],
  ['weekly', 'Weekly Bonus', ALL],
  ['monthly', 'Monthly Bonus', ALL],
  ['pre_monthly', 'Pre-Monthly Bonus', ALL.slice(1)],
  ['freespins', 'Weekly Freespins', ALL.slice(2)],
  ['representative', 'VIP Representative', ALL.slice(3)],
];

async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS vip_perks (
       id SERIAL PRIMARY KEY,
       key VARCHAR(40) UNIQUE,
       label VARCHAR(60) NOT NULL,
       enabled BOOLEAN NOT NULL DEFAULT TRUE,
       cards JSONB NOT NULL DEFAULT '[]',
       sort INTEGER NOT NULL DEFAULT 0,
       updated_by INTEGER,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  let sort = 0;
  for (const [key, label, cards] of DEFAULTS) {
    sort += 1;
    await sequelize.query(
      'INSERT INTO vip_perks (key, label, cards, sort) VALUES (:key, :label, :cards::jsonb, :sort) ON CONFLICT (key) DO NOTHING',
      { replacements: { key, label, cards: JSON.stringify(cards), sort }, transaction }
    );
  }
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS vip_perks', { transaction });
}

module.exports = { up, down };
