'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 039.
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One row per race type. The whole promotion is configuration: the multipliers
 * that turn turnover into points, the pool, and how the pool is split.
 */
class RaceConfig extends Model {}

module.exports = (sequelize) => {
  RaceConfig.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      /** `daily` | `weekly`. Unique — a config is addressed by its type. */
      type: { type: DataTypes.STRING(10), allowNull: false, unique: true, field: 'type' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'enabled' },

      sports_points: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: '0', field: 'sports_points' },
      casino_points: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: '0', field: 'casino_points' },
      slot_points: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: '0', field: 'slot_points' },
      crash_points: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: '0', field: 'crash_points' },
      /** The fall-through bucket, configurable rather than disguised as slots. */
      other_points: { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: '0', field: 'other_points' },

      prize_pool: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'prize_pool' },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'USDT', field: 'currency' },
      platform_fee_percent: {
        type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: '0', field: 'platform_fee_percent',
      },
      winner_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10, field: 'winner_count' },
      top3_percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: '60', field: 'top3_percentage' },
      /** `[{rank, percentage, amount}]`, computed on save. */
      rank_percentage: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'rank_percentage' },
      min_points: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'min_points' },

      booked_seats_enabled: {
        type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'booked_seats_enabled',
      },
      /** Ranks reserved for decorative entries, e.g. `[1, 3, 7]`. */
      booked_seats: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'booked_seats' },

      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'RaceConfig',
      tableName: 'race_config',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return RaceConfig;
};
