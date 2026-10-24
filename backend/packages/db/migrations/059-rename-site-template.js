'use strict';

const { featureCatalogue } = require('@ibitplay/common');

const { LEGACY_TEMPLATES } = featureCatalogue;

/** The row FeaturesService keeps the site's template in. */
const TEMPLATE_ROW = '_template';

/**
 * Rename the stored site template away from the clone it was built from.
 *
 * The `_template` row of `site_features` held `stake`, `shuffle`, `bcgame` or
 * `addaplay` — names of other sites, shown to the operator as "the template
 * this site runs". Templates are now named for their colour theme
 * (`carbon_gold`, `violet_night`, `emerald_dark`, `neon_navy`), as 048 did for
 * the variants. `resolveTemplateKey` keeps an unmigrated row working; this
 * makes the row itself say the new name.
 *
 * Only the `_template` row, and only while it holds an old name — running it
 * twice changes nothing. `down` puts the old name back.
 */
async function up({ sequelize, transaction, logger }) {
  let moved = 0;
  for (const [from, to] of Object.entries(LEGACY_TEMPLATES)) {
    const [, meta] = await sequelize.query(
      'UPDATE site_features SET variant = :to, updated_at = CURRENT_TIMESTAMP WHERE feature = :feature AND variant = :from',
      { replacements: { feature: TEMPLATE_ROW, from, to }, transaction }
    );
    moved += meta?.rowCount ?? 0;
  }
  logger?.info({ rows: moved }, 'Renamed the site template off the clone name');
}

async function down({ sequelize, transaction, logger }) {
  let moved = 0;
  for (const [from, to] of Object.entries(LEGACY_TEMPLATES)) {
    const [, meta] = await sequelize.query(
      'UPDATE site_features SET variant = :from, updated_at = CURRENT_TIMESTAMP WHERE feature = :feature AND variant = :to',
      { replacements: { feature: TEMPLATE_ROW, from, to }, transaction }
    );
    moved += meta?.rowCount ?? 0;
  }
  logger?.warn({ rows: moved }, 'Restored the clone-named site template');
}

module.exports = { up, down };
