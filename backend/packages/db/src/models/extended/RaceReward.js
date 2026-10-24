'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 039.
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A settled prize, owed to a real player and not yet paid.
 *
 * Settlement writes these; claiming credits the wallet and flips `claimed` in
 * the same conditional UPDATE. Nothing here belongs to a decorative entry —
 * see the note in migration 039 on why that mattered.
 */
class RaceReward extends Model {}

module.exports = (sequelize) => {
  RaceReward.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      race_id: { type: DataTypes.BIGINT, allowNull: false, field: 'race_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      type: { type: DataTypes.STRING(10), allowNull: false, field: 'type' },
      rank: { type: DataTypes.INTEGER, allowNull: false, field: 'rank' },
      points: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'points' },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'USDT', field: 'currency' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },

      claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'claimed' },
      claimed_at: { type: DataTypes.DATE, allowNull: true, field: 'claimed_at' },
      balance_before: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'balance_before' },
      balance_after: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'balance_after' },

      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'RaceReward',
      tableName: 'race_rewards',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return RaceReward;
};
