'use strict';

/** Extra promotion embeds: qualifying games, sports events, leaderboard, panel, tags. */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE promotions
       ADD COLUMN IF NOT EXISTS view_all_href     VARCHAR(512),
       ADD COLUMN IF NOT EXISTS qualifying_games  JSONB NOT NULL DEFAULT '[]'::jsonb,
       ADD COLUMN IF NOT EXISTS sport_events      JSONB NOT NULL DEFAULT '[]'::jsonb,
       ADD COLUMN IF NOT EXISTS leaderboard       JSONB,
       ADD COLUMN IF NOT EXISTS tournament_panel  JSONB,
       ADD COLUMN IF NOT EXISTS tags              JSONB NOT NULL DEFAULT '[]'::jsonb`,
    { transaction }
  );

  logger?.info('Added promotion embed columns');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(
    `ALTER TABLE promotions
       DROP COLUMN IF EXISTS view_all_href,
       DROP COLUMN IF EXISTS qualifying_games,
       DROP COLUMN IF EXISTS sport_events,
       DROP COLUMN IF EXISTS leaderboard,
       DROP COLUMN IF EXISTS tournament_panel,
       DROP COLUMN IF EXISTS tags`,
    { transaction }
  );
}

module.exports = { up, down };
