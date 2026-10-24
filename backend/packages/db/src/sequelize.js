'use strict';

const { Sequelize } = require('sequelize');
const pg = require('pg');

/**
 * The single Sequelize connection every service uses.
 *
 * All four services talk to the SAME database — the split is at the service
 * boundary, not the storage layer. That is deliberate: a sports bet has to
 * debit a wallet in one transaction, and splitting those across databases
 * would trade a real ACID guarantee for a distributed-transaction problem
 * nobody wants in a system that moves money.
 *
 * Ownership is enforced by convention instead (see tools/domain-map.js): one
 * service writes a table, the others go through its API.
 */

// pg hands back bigint and numeric as strings to avoid silent precision loss.
// We keep numerics as strings on purpose — money never becomes a JS float —
// but bigint ids are safe to widen to Number and much nicer to work with.
pg.defaults.parseInt8 = true;
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => (value === null ? null : Number(value)));

let instance = null;

/**
 * The database credentials THIS service connects with.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY A SERVICE MAY HAVE ITS OWN ROLE
 *
 * All four services connected as one Postgres user with full rights on the
 * whole database. `SERVICE_DOMAINS` looks like isolation but only decides
 * which Sequelize models get REGISTERED — it is advisory, and nothing stopped
 * sports-service running `SELECT * FROM users`. A compromise of the service
 * that mostly polls an odds feed was a compromise of every player record,
 * balance and password hash.
 *
 * `tools/db-grants.js` creates a role per service, granted only the tables
 * that service actually touches — derived from its models AND from the raw SQL
 * it runs, because several cross-domain writes are deliberate and invisible to
 * a model-based analysis.
 *
 * ── OPT-IN, PER SERVICE ──────────────────────────────────────────────────
 *
 * `DB_USER_SPORTS_SERVICE` / `DB_PASSWORD_SPORTS_SERVICE`, and so on. Unset
 * means fall back to `DB_USER` — so a deployment that has not run the grants
 * connects exactly as it did before, and the roles can be adopted one service
 * at a time rather than in a flag day across four.
 * ═════════════════════════════════════════════════════════════════════════
 */
function resolveCredentials(config) {
  const service = config.SERVICE_NAME;
  if (!service) return { username: config.DB_USER, password: config.DB_PASSWORD, scoped: false };

  const suffix = String(service).replace(/-/g, '_').toUpperCase();
  const username = config[`DB_USER_${suffix}`];

  // Both or neither. A username with no password would fall back to the shared
  // password and connect as the wrong principal, which is worse than not
  // scoping at all — it would look scoped while silently failing to be.
  const password = config[`DB_PASSWORD_${suffix}`];
  if (!username || !password) {
    return { username: config.DB_USER, password: config.DB_PASSWORD, scoped: false };
  }

  return { username, password, scoped: true };
}

function buildConfig(config, logger) {
  const { username, password, scoped } = resolveCredentials(config);

  if (scoped) {
    logger?.info({ role: username }, 'Connected with a service-scoped database role');
  } else if (config.SERVICE_NAME) {
    logger?.warn(
      { service: config.SERVICE_NAME },
      'Connecting as the shared DB_USER — this service has full rights on every table in the database. ' +
        'Run `node tools/db-grants.js --apply` and set DB_USER_* to scope it to the tables it uses.'
    );
  }

  return {
    dialect: 'postgres',
    dialectModule: pg,
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    username,
    password,
    schema: config.DB_SCHEMA || 'public',
    // Pin the search_path per connection. Without it, a connection that picked
    // up an empty search_path (as pg_dump's preamble sets) fails on any
    // unqualified object reference.
    searchPath: config.DB_SCHEMA || 'public',

    logging: config.DB_LOGGING ? (sql, timing) => logger?.debug({ timing }, sql) : false,
    benchmark: Boolean(config.DB_LOGGING),

    pool: {
      max: config.DB_POOL_MAX ?? 20,
      min: config.DB_POOL_MIN ?? 2,
      idle: config.DB_POOL_IDLE_MS ?? 10_000,
      acquire: config.DB_POOL_ACQUIRE_MS ?? 30_000,
      // Recycle connections periodically so a long-lived pool does not pin
      // server-side memory or survive a failover to a stale primary.
      evict: 60_000,
    },

    dialectOptions: {
      ssl: config.DB_SSL ? { require: true, rejectUnauthorized: false } : false,
      // A runaway query holding a row lock is worse than a failed request.
      statement_timeout: config.DB_STATEMENT_TIMEOUT_MS ?? 30_000,
      idle_in_transaction_session_timeout: 60_000,
      application_name: config.SERVICE_NAME || 'ibitplay',
      keepAlive: true,
    },

    define: {
      // The legacy schema is snake_case with inconsistent conventions; models
      // declare `field` explicitly rather than relying on auto-translation.
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    },

    // READ COMMITTED matches Postgres's default. Balance updates rely on
    // SELECT ... FOR UPDATE rather than a stricter isolation level, which
    // would mean serialization failures under normal betting load.
    isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,

    retry: {
      // Retry only transient connection faults — never a constraint violation.
      match: [/SequelizeConnectionError/, /SequelizeConnectionRefusedError/, /ECONNRESET/, /ETIMEDOUT/],
      max: 3,
    },
  };
}

/** Create (once) and return the shared Sequelize instance. */
function createSequelize(config, logger) {
  if (instance) return instance;
  instance = new Sequelize(buildConfig(config, logger));
  return instance;
}

function getSequelize() {
  if (!instance) throw new Error('Sequelize has not been initialised — call connect() during service boot');
  return instance;
}

/** Verify the connection at boot so a bad DSN fails fast, not on first request. */
async function authenticate(sequelize, logger, { retries = 5, delayMs = 2_000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await sequelize.authenticate();
      const [{ version }] = await sequelize.query('SELECT version()', { type: sequelize.QueryTypes.SELECT });
      logger?.info({ database: sequelize.config.database, host: sequelize.config.host }, `Database connected (${String(version).split(',')[0]})`);
      return;
    } catch (error) {
      if (attempt === retries) {
        logger?.fatal({ err: error }, `Database connection failed after ${retries} attempts`);
        throw error;
      }
      logger?.warn({ attempt, retries, err: error.message }, 'Database connection failed — retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { createSequelize, getSequelize, authenticate, Sequelize, resolveCredentials };
