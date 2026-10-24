'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 006-settlement-queue.
// Domain: extended/sports — owned by sports-service.

const { Model, DataTypes } = require('sequelize');

/**
 * Markets waiting to be settled.
 *
 * Created by migration 006 and, until now, referenced by nothing — the table
 * existed in every environment and no code could address it, because it had no
 * model. Found by the orphan-table check in `tools/verify-models.js`.
 *
 * That is worth stating plainly rather than quietly fixing: a queue table with
 * no consumer is not a harmless leftover. The settlement worker is supposed to
 * drain it, and until it does, `run_after` and `attempts` are doing nothing —
 * a settlement that fails is retried by whatever called it, or not at all.
 *
 * The model is added here so the worker has something to write against. Wiring
 * the worker to it is a separate change, and is still outstanding.
 */
class SportsSettlementQueue extends Model {}

module.exports = (sequelize) => {
  SportsSettlementQueue.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      match_id: { type: DataTypes.STRING(120), allowNull: false, field: 'match_id' },
      event_id: { type: DataTypes.STRING(120), allowNull: true, field: 'event_id' },
      /** pending | processing | settled | failed */
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', field: 'status' },
      /** The result to apply. jsonb so a failed job can be inspected as data. */
      payload: { type: DataTypes.JSONB, allowNull: false, field: 'payload' },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'attempts' },
      last_error: { type: DataTypes.STRING(500), allowNull: true, field: 'last_error' },
      /** Backoff: do not pick this up before this instant. */
      run_after: { type: DataTypes.DATE, allowNull: true, field: 'run_after' },
      settled_at: { type: DataTypes.DATE, allowNull: true, field: 'settled_at' },
    },
    {
      sequelize,
      modelName: 'SportsSettlementQueue',
      tableName: 'sports_settlement_queue',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return SportsSettlementQueue;
};
