'use strict';

/**
 * site_features — which variant of each feature this site offers.
 *
 * One row per feature. The MENU of features and variants is code
 * (packages/common/src/featureCatalogue.js); this table is the SELECTION,
 * and each site's database holds its own.
 *
 * `config` is what may be shown; `secrets` holds only values sealed with the
 * platform's SecretBox (the same key that seals staff 2FA secrets), so a dump
 * of this table does not hand over a provider's API key.
 *
 * Idempotent: every statement is IF NOT EXISTS.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS site_features (
       feature     VARCHAR(64)  PRIMARY KEY,
       -- Off until someone who has looked at the screen turns it on.
       enabled     BOOLEAN      NOT NULL DEFAULT false,
       variant     VARCHAR(64)  NOT NULL DEFAULT 'none',
       config      JSONB        NOT NULL DEFAULT '{}'::jsonb,
       secrets     JSONB        NOT NULL DEFAULT '{}'::jsonb,
       updated_by  VARCHAR(190),
       created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  logger?.info('Created site_features — the per-site selection of feature variants');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      "Dropping this discards every site's feature selection and its sealed integration keys. " +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS site_features', { transaction });
  logger?.warn('Dropped site_features');
}

module.exports = { up, down };
