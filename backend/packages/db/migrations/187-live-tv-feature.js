'use strict';

/**
 * Live TV (sports): the site_features row, so Site config → Features shows what is enforced —
 * the gate, on, at ₹200 and 10 hours (owner, 2026-11-01) — and the numbers are there to edit
 * (user-service modules/live-tv). A site that already has a row keeps it.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `INSERT INTO site_features (feature, variant, enabled, config, secrets, updated_by)
     VALUES ('live_tv', 'gated', true, '{"minBalance": "200", "inactiveHours": "10"}'::jsonb, '{}'::jsonb, 'migration')
     ON CONFLICT (feature) DO NOTHING`,
    { transaction }
  );
  logger?.info('live_tv feature: gated, ₹200 / 10 hours');
}

async function down({ sequelize, transaction }) {
  await sequelize.query(`DELETE FROM site_features WHERE feature = 'live_tv' AND updated_by = 'migration'`, { transaction });
}

module.exports = { up, down };
