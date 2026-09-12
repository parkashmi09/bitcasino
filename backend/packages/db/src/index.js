'use strict';

const { Sequelize, Op, QueryTypes, DataTypes, literal, fn, col, where } = require('sequelize');

const { createSequelize, getSequelize, authenticate } = require('./sequelize');
const { registerModels, registerForService, DOMAINS, SERVICE_DOMAINS } = require('./models');
const { withTransaction, lockRow, lockRowsInOrder, withAdvisoryLock } = require('./transaction');
const { BaseRepository } = require('./BaseRepository');

/**
 * @ibitplay/db — the shared data layer.
 *
 * A service boots with one call:
 *
 *   const db = await connect({ config, logger, service: 'user-service' })
 *   db.models.Users, db.sequelize, db.transaction(fn)
 */

let connection = null;

async function connect({ config, logger, service, domains } = {}) {
  if (connection) return connection;

  const sequelize = createSequelize({ ...config, SERVICE_NAME: service }, logger);
  await authenticate(sequelize, logger);

  const models = domains
    ? registerModels(sequelize, { domains, logger })
    : registerForService(sequelize, service, { logger });

  connection = {
    sequelize,
    models,
    Sequelize,
    Op,
    QueryTypes,
    DataTypes,
    literal,
    fn,
    col,
    where,

    /** Run `fn` inside a transaction, retrying serialization conflicts. */
    transaction: (fn_, options) => withTransaction(sequelize, fn_, { logger, ...options }),
    lockRow,
    lockRowsInOrder,
    advisoryLock: (key, fn_, options) => withAdvisoryLock(sequelize, key, fn_, options),

    /** Health-check probe: cheap round trip that proves the pool is usable. */
    async ping() {
      await sequelize.query('SELECT 1', { type: QueryTypes.SELECT });
      const pool = sequelize.connectionManager.pool;
      return { size: pool?.size ?? null, available: pool?.available ?? null, using: pool?.using ?? null };
    },

    async close() {
      await sequelize.close();
      connection = null;
      logger?.info('Database connection closed');
    },
  };

  return connection;
}

function getConnection() {
  if (!connection) throw new Error('Database not connected — call connect() during service boot');
  return connection;
}

module.exports = {
  connect,
  getConnection,
  getSequelize,
  createSequelize,
  authenticate,
  registerModels,
  registerForService,
  BaseRepository,
  withTransaction,
  lockRow,
  lockRowsInOrder,
  withAdvisoryLock,
  DOMAINS,
  SERVICE_DOMAINS,
  Sequelize,
  Op,
  QueryTypes,
  DataTypes,
  literal,
  fn,
  col,
  where,
};
