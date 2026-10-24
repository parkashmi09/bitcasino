'use strict';

const { featureCatalogue } = require('@ibitplay/common');

const { LEGACY_VARIANTS } = featureCatalogue;

/**
 * Rename the stored feature variants away from the clone they were built from.
 *
 * `site_features.variant` held `shuffle`, `bcgame`, `stake` — the name of the
 * site each surface was ported from. An operator choosing "Stake-style lobby"
 * for their own brand is being asked a question only this repo can answer, so
 * the variants are named for what they ARE (`in_house`, `aggregator`,
 * `tabbed_themes`) and the rows follow.
 *
 * Only rows this map names are touched, and only when they still hold an old
 * name — running it twice changes nothing. `down` puts the old names back, one
 * per feature, so a rollback lands on a schema the previous code understands.
 */
async function up({ sequelize, transaction, logger }) {
  let moved = 0;
  for (const [feature, aliases] of Object.entries(LEGACY_VARIANTS)) {
    for (const [from, to] of Object.entries(aliases)) {
      const [, meta] = await sequelize.query(
        'UPDATE site_features SET variant = :to, updated_at = CURRENT_TIMESTAMP WHERE feature = :feature AND variant = :from',
        { replacements: { feature, from, to }, transaction }
      );
      moved += meta?.rowCount ?? 0;
    }
  }
  logger?.info({ rows: moved }, 'Renamed feature variants off the clone names');
}

async function down({ sequelize, transaction, logger }) {
  let moved = 0;
  for (const [feature, aliases] of Object.entries(LEGACY_VARIANTS)) {
    for (const [from, to] of Object.entries(aliases)) {
      const [, meta] = await sequelize.query(
        'UPDATE site_features SET variant = :from, updated_at = CURRENT_TIMESTAMP WHERE feature = :feature AND variant = :to',
        { replacements: { feature, from, to }, transaction }
      );
      moved += meta?.rowCount ?? 0;
    }
  }
  logger?.warn({ rows: moved }, 'Restored the clone-named feature variants');
}

module.exports = { up, down };
