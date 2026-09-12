'use strict';

/**
 * Match-level settlement queue.
 *
 * The baseline already has `sports_event_settlement_jobs`, but it is keyed
 * per BET — `UNIQUE (user_id, eventid, bet_id)`. That matches the legacy
 * design, where settlement walked bet by bet and updated each player's balance
 * individually.
 *
 * The new settlement path works per MATCH: `SportsBetService.settleMatch()`
 * takes one advisory lock for the match, settles every open bet on it inside a
 * single transaction, then pays out. Queueing that per bet would take the same
 * lock N times and defeat the batching entirely.
 *
 * So this adds a queue at the right granularity and leaves the legacy table
 * untouched for anything still reading it.
 */

async function up({ queryInterface, sequelize, transaction, logger }) {
  const { DataTypes } = require('sequelize');

  await queryInterface.createTable(
    'sports_settlement_queue',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },

      match_id: { type: DataTypes.STRING(100), allowNull: false },
      event_id: { type: DataTypes.STRING(100), allowNull: true },

      // 'queued' | 'settling' | 'settled' | 'failed'
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'queued' },

      // { winners: [...], voids: [...], source, raw }
      payload: { type: DataTypes.JSONB, allowNull: false },

      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: DataTypes.STRING(500), allowNull: true },

      // Lets a failed match back off instead of being retried every minute.
      run_after: { type: DataTypes.DATE, allowNull: true },
      settled_at: { type: DataTypes.DATE, allowNull: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
    },
    { transaction }
  );

  /**
   * One OPEN queue row per match.
   *
   * Partial unique index rather than a plain one: a match can legitimately be
   * queued again later (a corrected result, a manual re-settlement), so
   * uniqueness must only apply while a row is still outstanding. Without the
   * WHERE clause, re-settling a match after a result correction would be
   * blocked by the old settled row.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_queue_open
       ON sports_settlement_queue (match_id)
     WHERE status IN ('queued', 'settling')`,
    { transaction }
  );

  // The claim query: oldest queued row that is ready to run.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_settlement_queue_claim
       ON sports_settlement_queue (status, run_after NULLS FIRST, created_at)`,
    { transaction }
  );

  logger?.info('Created sports_settlement_queue');
}

async function down({ queryInterface, sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_settlement_queue_claim', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS uq_settlement_queue_open', { transaction });
  await queryInterface.dropTable('sports_settlement_queue', { transaction });
}

module.exports = { up, down };
