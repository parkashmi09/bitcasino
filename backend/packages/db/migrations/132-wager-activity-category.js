'use strict';

/**
 * What KIND of bet each counted stake was — the hash.game formulas price by it.
 *
 *   category    originals | slots | live | sports  (commission game rate, bonus contribution)
 *   provider    catalogue provider / vendor          (wager contribution list)
 *   game_ref    catalogue uuid / game code
 *   odds        sports only — a bet under 1.5 does not count toward a bonus
 *   house_edge  fraction (0.04 = 4%) — rakeback and bonus unlock are `wager × house edge × rate`
 *   rate_used   USD per unit at the time of the bet, so a later rate change does not rewrite history
 *
 * Old rows stay NULL and read as `slots` with the category default house edge.
 */
const COLUMNS = [
  ['category', 'TEXT'],
  ['provider', 'TEXT'],
  ['game_ref', 'TEXT'],
  ['odds', 'NUMERIC(12, 4)'],
  ['house_edge', 'NUMERIC(8, 6)'],
  ['rate_used', 'NUMERIC(30, 12)'],
];

async function up({ sequelize, transaction }) {
  for (const [name, type] of COLUMNS) {
    await sequelize.query(`ALTER TABLE wager_activity ADD COLUMN IF NOT EXISTS ${name} ${type}`, { transaction });
  }
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_wager_activity_user_category ON wager_activity (user_id, category, created_at)',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_wager_activity_user_category', { transaction });
  for (const [name] of COLUMNS) {
    await sequelize.query(`ALTER TABLE wager_activity DROP COLUMN IF EXISTS ${name}`, { transaction });
  }
}

module.exports = { up, down };
