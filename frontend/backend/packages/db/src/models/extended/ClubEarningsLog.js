'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 014.
// Domain: extended/core — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * What a club's owner, agents and members earned from play, and when.
 *
 * The weakest reconstruction in this port. The legacy code names this table
 * exactly once — in the generic table-fetch endpoint's allow-list, which tells
 * us only that it has a `club_id`. Everything else is inferred from
 * `club_earnings_configurations`, which holds the owner/agent/member
 * percentages this log must be applying.
 *
 * Treat the shape as a starting point. Nothing writes to it yet; the earnings
 * job that should is not part of this port.
 */
class ClubEarningsLog extends Model {}

module.exports = (sequelize) => {
  ClubEarningsLog.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      club_id: { type: DataTypes.BIGINT, allowNull: false, field: 'club_id' },
      /** Who is owed this line. */
      beneficiary_id: { type: DataTypes.BIGINT, allowNull: false, field: 'beneficiary_id' },
      /** Whose play produced it. Null for a club-wide accrual. */
      source_user_id: { type: DataTypes.BIGINT, allowNull: true, field: 'source_user_id' },
      beneficiary_role: { type: DataTypes.STRING(20), allowNull: false, field: 'beneficiary_role' },
      wager_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'wager_amount' },
      percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: '0', field: 'percentage' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'amount' },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'BJB', field: 'currency' },
      period_start: { type: DataTypes.DATE, allowNull: true, field: 'period_start' },
      period_end: { type: DataTypes.DATE, allowNull: true, field: 'period_end' },
      paid: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'paid' },
      paid_at: { type: DataTypes.DATE, allowNull: true, field: 'paid_at' },
    },
    {
      sequelize,
      modelName: 'ClubEarningsLog',
      tableName: 'club_earnings_log',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return ClubEarningsLog;
};
