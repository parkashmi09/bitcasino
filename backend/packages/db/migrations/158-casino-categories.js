'use strict';

/**
 * `casino_categories` — the casino lobby's sections after Lobby and Originals, run by the
 * site admin (Casino › Lobby curation › Add category).
 *
 * One row per section: its URL key (`slug`, the `/casino/:tab` segment), its label, its place
 * in the strip and its hand-picked games in display order. A section with no games picked
 * keeps its old automatic list on the site (the frontend's SET_QUERY by slug), so seeding the
 * eleven existing tabs here changes nothing until an operator curates one.
 */

const SEED = [
  ['hot', 'Hot Games'],
  ['slots', 'Slots'],
  ['live', 'Live Casino'],
  ['game-shows', 'Game Shows'],
  ['table-game', 'Table Games'],
  ['blackjack', 'Blackjack'],
  ['roulette', 'Roulette'],
  ['baccarat', 'Baccarat'],
  ['new', 'New Releases'],
  ['crash-games', 'Burst Games'],
  ['poker', 'Poker'],
];

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS casino_categories (
       id          SERIAL PRIMARY KEY,
       slug        VARCHAR(60)  NOT NULL UNIQUE,
       name        VARCHAR(60)  NOT NULL,
       sort_order  INTEGER      NOT NULL DEFAULT 0,
       active      BOOLEAN      NOT NULL DEFAULT TRUE,
       game_uuids  TEXT[]       NOT NULL DEFAULT '{}',
       updated_by  INTEGER,
       created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
  for (const [index, [slug, name]] of SEED.entries()) {
    await sequelize.query(
      `INSERT INTO casino_categories (slug, name, sort_order) VALUES (:slug, :name, :order) ON CONFLICT (slug) DO NOTHING`,
      { transaction, replacements: { slug, name, order: index + 1 } }
    );
  }
  logger?.info('Created casino_categories with the eleven lobby tabs');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DROP TABLE IF EXISTS casino_categories`, { transaction });
}

module.exports = { up, down };
