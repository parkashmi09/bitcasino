'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 076.
// Domain: extended — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * Which stake moved which bonus, and by how much (in the bonus's currency). Unique per
 * `(bonus_id, source, ref)`; `reversed_at` is set when the stake was refunded / rolled back.
 */
class PlayerBonusWager extends Model {}

module.exports = (sequelize) => {
  PlayerBonusWager.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      bonus_id: { type: DataTypes.BIGINT, allowNull: false, field: 'bonus_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      source: { type: DataTypes.STRING(40), allowNull: false, field: 'source' },
      ref: { type: DataTypes.STRING(190), allowNull: false, field: 'ref' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },
      reversed_at: { type: DataTypes.DATE, allowNull: true, field: 'reversed_at' },
      /** Taken back out by a (partial) stake reversal (migration 090); `amount` is what still counts. */
      reversed_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'reversed_amount' },
    },
    {
      sequelize,
      modelName: 'PlayerBonusWager',
      tableName: 'player_bonus_wagers',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return PlayerBonusWager;
};
