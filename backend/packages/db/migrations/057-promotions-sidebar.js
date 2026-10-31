'use strict';

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE promotions
       ADD COLUMN IF NOT EXISTS sidebar_enabled   BOOLEAN NOT NULL DEFAULT false,
       ADD COLUMN IF NOT EXISTS sidebar_label     VARCHAR(512),
       ADD COLUMN IF NOT EXISTS sidebar_icon      VARCHAR(128),
       ADD COLUMN IF NOT EXISTS sidebar_counter   VARCHAR(32),
       ADD COLUMN IF NOT EXISTS sidebar_sort      INTEGER NOT NULL DEFAULT 0`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_promotions_sidebar
       ON promotions (sidebar_sort ASC, published_at DESC)
      WHERE sidebar_enabled AND is_published`,
    { transaction }
  );

  logger?.info('Added promotion sidebar columns');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS ix_promotions_sidebar', { transaction });
  await sequelize.query(
    `ALTER TABLE promotions
       DROP COLUMN IF EXISTS sidebar_enabled,
       DROP COLUMN IF EXISTS sidebar_label,
       DROP COLUMN IF EXISTS sidebar_icon,
       DROP COLUMN IF EXISTS sidebar_counter,
       DROP COLUMN IF EXISTS sidebar_sort`,
    { transaction }
  );
}

module.exports = { up, down };
