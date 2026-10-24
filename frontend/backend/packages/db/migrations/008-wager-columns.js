'use strict';

/**
 * Declare the wagering columns properly.
 *
 * `legacy/fiatdeposit/controller.js` carried an `ensureWagerSchema()` that ran
 *
 *   ALTER TABLE users
 *     ADD COLUMN IF NOT EXISTS wager_multiplier numeric DEFAULT 3,
 *     ADD COLUMN IF NOT EXISTS lock_targetx boolean DEFAULT false
 *
 * on every request that touched the targetX endpoints. Schema changes at
 * request time are a problem for three reasons: they need DDL privileges on the
 * application's database role, they take a lock on `users` at unpredictable
 * moments, and the columns are absent from `000_baseline_schema.sql`, so no
 * model or fresh database knows about them until someone happens to call the
 * right endpoint.
 *
 * This does it once, in the right place.
 */

async function up({ sequelize, transaction, logger }) {
  const { QueryTypes } = require('sequelize');

  const existing = await sequelize.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'`,
    { type: QueryTypes.SELECT, transaction }
  );
  const columns = new Set(existing.map((c) => c.column_name));

  if (!columns.has('wager_multiplier')) {
    await sequelize.query(
      'ALTER TABLE users ADD COLUMN wager_multiplier NUMERIC(10,4) DEFAULT 3',
      { transaction }
    );
    logger?.info('Added users.wager_multiplier');
  }

  if (!columns.has('lock_targetx')) {
    await sequelize.query(
      'ALTER TABLE users ADD COLUMN lock_targetx BOOLEAN DEFAULT false',
      { transaction }
    );
    logger?.info('Added users.lock_targetx');
  }

  // The bulk-update path filters on this, and it is a full scan of `users`
  // without an index.
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS users_lock_targetx_idx ON users (lock_targetx) WHERE lock_targetx = true',
    { transaction }
  );

  logger?.info('Wagering columns are in place');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP INDEX IF EXISTS users_lock_targetx_idx', { transaction });
  // The columns are kept: dropping them discards every per-player wagering
  // agreement, which is not recoverable from anywhere else.
  logger?.warn('Dropped the wagering index. users.wager_multiplier and .lock_targetx were KEPT.');
}

module.exports = { up, down };
