'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 163 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One loss or wager limit a player set on themselves — see migration 163. */
class PlayerGamblingLimit extends Model {}

module.exports = (sequelize) => {
  PlayerGamblingLimit.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      /** LOSS_LIMIT | WAGER_LIMIT. */
      type: { type: DataTypes.STRING(12), allowNull: false, field: 'type' },
      usd_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'usd_amount' },
      /** DAYS | WEEKS | MONTHS. */
      period_unit: { type: DataTypes.STRING(6), allowNull: false, field: 'period_unit' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      /** Removal requested: in force until then, gone after. */
      expires_at: { type: DataTypes.DATE, allowNull: true, field: 'expires_at' },
    },
    {
      sequelize,
      modelName: 'PlayerGamblingLimit',
      tableName: 'player_gambling_limits',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
      indexes: [{ name: 'idx_player_gambling_limits_user', fields: ['user_id', 'created_at'] }],
    }
  );

  return PlayerGamblingLimit;
};
