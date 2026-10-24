'use strict';

/**
 * `og_games` — the Original Games Aggregator's catalogue, as its `GET /v1/games` last answered
 * (`node scripts/sync-original-games.js`). The lobby's Originals row reads it through
 * `GET /api/v1/casino/original-games/games`; `data` keeps the provider's row (limits, art).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS og_games (
       code       TEXT PRIMARY KEY,
       name       TEXT NOT NULL,
       position   INTEGER NOT NULL DEFAULT 0,
       data       JSONB NOT NULL DEFAULT '{}'::jsonb,
       synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS og_games', { transaction });
}

module.exports = { up, down };
