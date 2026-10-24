'use strict';

const fs = require('fs');
const path = require('path');
const { applyAssociations } = require('./associations');
const { applyExtensions } = require('./extensions');

/**
 * Model registry.
 *
 * A service loads only the domains it owns plus the ones it reads. That keeps
 * boot fast and, more importantly, makes an accidental cross-domain write
 * obvious in review: if casino-service is calling `models.Staff.update()`,
 * either the domain list is wrong or the code is.
 *
 *   const models = registerModels(sequelize, { domains: ['core', 'casino'] })
 *
 * Omitting `domains` loads everything — what the migration CLI and admin
 * service want.
 */

// `extended` holds hand-written models for tables this platform added on top
// of the legacy baseline (auth sessions, login attempts, verification tokens).
// It is kept apart from the generated domains so a regeneration never touches it.
const DOMAINS = ['core', 'payments', 'casino', 'sports', 'admin', 'extended'];

/** Which domains each service loads. Reads that cross a boundary go via HTTP. */
const SERVICE_DOMAINS = {
  'user-service': ['core', 'payments', 'extended'],
  'admin-service': ['admin', 'core', 'payments', 'casino', 'sports', 'extended'],
  // `extended` is loaded by every service that owns a post-baseline table.
  // casino-service needs `seamless_transactions` (migration 015) and
  // sports-service needs `sports_settlement_queue` (migration 006) — both are
  // hand-written, so neither lives in a generated domain.
  'casino-service': ['casino', 'core', 'extended'],
  'sports-service': ['sports', 'core', 'extended'],
  gateway: [],
};

const registries = new WeakMap();

function registerModels(sequelize, { domains = DOMAINS, logger } = {}) {
  // Initialising the same model twice on one connection throws; hand back the
  // registry we already built.
  if (registries.has(sequelize)) return registries.get(sequelize);

  const models = {};
  const modelsDir = __dirname;

  for (const domain of domains) {
    const domainDir = path.join(modelsDir, domain);
    if (!fs.existsSync(domainDir)) {
      logger?.warn({ domain }, 'Model domain directory not found — skipping');
      continue;
    }

    const files = fs
      .readdirSync(domainDir)
      .filter((file) => file.endsWith('.js') && file !== 'index.js')
      .sort();

    for (const file of files) {
      const define = require(path.join(domainDir, file));
      if (typeof define !== 'function') {
        logger?.warn({ file }, 'Model file does not export a factory function — skipping');
        continue;
      }
      const model = define(sequelize);
      models[model.name] = model;
    }
  }

  // Columns that migrations added on top of the generated baseline. Applied
  // BEFORE associations, so an association may reference one.
  applyExtensions(models, logger);

  // Associations run once, after every model exists — a belongsTo can name a
  // model that has not been defined yet if you wire them as you go.
  const { skipped } = applyAssociations(models, logger);
  if (skipped.length) {
    logger?.debug({ count: skipped.length }, 'Some associations were skipped (see debug log for details)');
  }

  // Let models reach their siblings without a circular require.
  for (const model of Object.values(models)) {
    if (typeof model.associate === 'function') model.associate(models);
  }

  const registry = Object.freeze({ ...models, sequelize, Sequelize: sequelize.constructor });
  registries.set(sequelize, registry);

  logger?.info({ count: Object.keys(models).length, domains }, 'Models registered');
  return registry;
}

/** Convenience: load exactly what a named service is allowed to touch. */
function registerForService(sequelize, serviceName, options = {}) {
  const domains = SERVICE_DOMAINS[serviceName];
  if (!domains) throw new Error(`Unknown service "${serviceName}" — add it to SERVICE_DOMAINS`);
  return registerModels(sequelize, { ...options, domains });
}

module.exports = { registerModels, registerForService, DOMAINS, SERVICE_DOMAINS };
