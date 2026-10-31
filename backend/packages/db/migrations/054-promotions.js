'use strict';

/** Marketing promotions — tiles and article pages on `/promotions` and `/sports/promotions`. */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS promotions (
       id              SERIAL PRIMARY KEY,
       segment         VARCHAR(20)  NOT NULL CHECK (segment IN ('casino', 'sports')),
       slug            VARCHAR(255) NOT NULL,
       title           VARCHAR(512) NOT NULL,
       summary         TEXT,
       description     TEXT         NOT NULL,
       image_alt       VARCHAR(512),
       image           TEXT,
       image_data      BYTEA,
       content_type    VARCHAR(60),
       byte_size       INTEGER,
       featured        BOOLEAN      NOT NULL DEFAULT false,
       promo_status    VARCHAR(20)  NOT NULL DEFAULT 'live' CHECK (promo_status IN ('live', 'ended')),
       ends_at         TIMESTAMPTZ,
       is_published    BOOLEAN      NOT NULL DEFAULT false,
       published_at    TIMESTAMPTZ,
       created_by      BIGINT,
       updated_by      BIGINT,
       created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       CONSTRAINT promotions_segment_slug_key UNIQUE (segment, slug)
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_promotions_published
       ON promotions (published_at DESC)
      WHERE is_published`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS ix_promotions_segment_published
       ON promotions (segment, published_at DESC)
      WHERE is_published`,
    { transaction }
  );

  logger?.info('Created promotions table');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS promotions', { transaction });
}

module.exports = { up, down };
