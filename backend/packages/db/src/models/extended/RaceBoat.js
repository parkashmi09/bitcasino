'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 039.
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A decorative leaderboard entry — an operator-placed row occupying a "booked
 * seat" so the board never looks empty.
 *
 * ── NO user_id ───────────────────────────────────────────────────────────
 *
 * The reference gave these fake ids at 900001+ so they could pass through the
 * same code as real players. They passed through SETTLEMENT too, and were
 * awarded prizes: rows against accounts that exist in no table, unclaimable by
 * anyone, permanently occupying paid ranks. Not being a user is what makes that
 * impossible here — `race_rewards.user_id` has nothing to put.
 *
 * Points are kept per race type so the daily and weekly placements never
 * overwrite each other.
 */
class RaceBoat extends Model {}

module.exports = (sequelize) => {
  RaceBoat.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      name: { type: DataTypes.STRING(60), allowNull: false, field: 'name' },
      daily_points: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'daily_points' },
      weekly_points: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'weekly_points' },
      daily_rank: { type: DataTypes.INTEGER, allowNull: true, field: 'daily_rank' },
      weekly_rank: { type: DataTypes.INTEGER, allowNull: true, field: 'weekly_rank' },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'RaceBoat',
      tableName: 'race_boats',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return RaceBoat;
};
