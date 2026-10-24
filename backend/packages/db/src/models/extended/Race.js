'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 039.
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One race window.
 *
 * `status` rather than a column called `end`: the reference implementation used
 * the reserved word, and the one SELECT that forgot to quote and list it left
 * the "is this race over" guard reading `undefined` forever. A settled race
 * went on serving live standings for three days.
 */
class Race extends Model {}

module.exports = (sequelize) => {
  Race.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      type: { type: DataTypes.STRING(10), allowNull: false, field: 'type' },
      /** Half-open: `>= starts_at`, `< ends_at`. */
      starts_at: { type: DataTypes.DATE, allowNull: false, field: 'starts_at' },
      ends_at: { type: DataTypes.DATE, allowNull: false, field: 'ends_at' },
      /** open | settled. One `open` per type, enforced by a partial unique index. */
      status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'open', field: 'status' },
      settled_at: { type: DataTypes.DATE, allowNull: true, field: 'settled_at' },
      /**
       * The configuration as it was at settlement. Null while open — there is
       * nothing to snapshot until the window closes, and writing zeroes there
       * (as the reference did) makes an open race look like one that paid out
       * nothing.
       */
      snapshot: { type: DataTypes.JSONB, allowNull: true, field: 'snapshot' },
      prize_pool: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'prize_pool' },
      platform_fee_percent: {
        type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: '0', field: 'platform_fee_percent',
      },
      winner_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'winner_count' },
      /** What was actually written to `race_rewards`, which is <= the net pool. */
      total_awarded: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'total_awarded' },

      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'Race',
      tableName: 'races',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Race;
};
