'use strict';

/**
 * `siteconfig.settings` — the business values an operator sets for themselves.
 *
 * ── WHY A COLUMN AND NOT MORE ENV ───────────────────────────────────────
 *
 * The minimum bet, the maximum payout, the timezone a weekly race resets in:
 * every one of these lived in `.env`, which means changing one is a deploy and
 * the person who can change it is whoever holds shell access. They are the
 * operator's decisions and belong where their other decisions are — in their
 * own admin, behind a permission, with an audit row.
 *
 * JSONB rather than a column each: the set grows as screens are wired, and a
 * migration per number would be a migration per week. What may be stored is
 * fixed in code (`OPERATOR_SETTINGS` in siteConfig.service.js), so the column
 * cannot become a junk drawer — an unknown key is refused by the route.
 *
 * Empty by default, and empty means "read the env value", so this migration
 * changes no behaviour on its own.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `ALTER TABLE siteconfig ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`,
    { transaction }
  );
  logger?.info('siteconfig.settings added — operator limits and policy live here now');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE siteconfig DROP COLUMN IF EXISTS settings', { transaction });
  logger?.warn('Dropped siteconfig.settings — every stored limit is gone; the services fall back to env');
}

module.exports = { up, down };
