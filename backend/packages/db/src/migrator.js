'use strict';

const path = require('path');
const fs = require('fs');
const { Umzug, SequelizeStorage } = require('umzug');

/**
 * Migration runner (Umzug over the shared Sequelize connection).
 *
 * Migrations are plain files in `migrations/`, applied in filename order and
 * recorded in `sequelize_meta`. The first one loads the baseline schema dump;
 * everything after it is an incremental change.
 *
 * Each migration runs inside a transaction, so a failure half way through
 * leaves the schema exactly as it was rather than in an undefined state.
 */

function createMigrator({ sequelize, logger, migrationsPath, seedersPath }) {
  const migrationsDir = migrationsPath || path.join(__dirname, '..', 'migrations');
  const seedersDir = seedersPath || path.join(__dirname, '..', 'seeders');

  const build = (dir, tableName) =>
    new Umzug({
      migrations: {
        glob: ['*.js', { cwd: dir }],
        resolve: ({ name, path: filePath, context }) => {
          const migration = require(filePath);
          return {
            name,
            up: async () =>
              sequelize.transaction(async (transaction) =>
                migration.up({ ...context, transaction })
              ),
            down: async () =>
              sequelize.transaction(async (transaction) =>
                migration.down
                  ? migration.down({ ...context, transaction })
                  : Promise.reject(new Error(`Migration ${name} has no down() — it cannot be reverted`))
              ),
          };
        },
      },
      context: { sequelize, queryInterface: sequelize.getQueryInterface(), logger },
      storage: new SequelizeStorage({ sequelize, tableName }),
      logger: {
        info: (msg) => logger?.info(typeof msg === 'string' ? msg : msg.event ? `${msg.event}: ${msg.name || ''}` : msg),
        warn: (msg) => logger?.warn(msg),
        error: (msg) => logger?.error(msg),
        debug: () => {},
      },
    });

  if (!fs.existsSync(migrationsDir)) fs.mkdirSync(migrationsDir, { recursive: true });
  if (!fs.existsSync(seedersDir)) fs.mkdirSync(seedersDir, { recursive: true });

  return {
    migrations: build(migrationsDir, 'sequelize_meta'),
    // Seeds are tracked separately so re-running migrations never re-seeds.
    seeders: build(seedersDir, 'sequelize_seed_meta'),
  };
}

module.exports = { createMigrator };
