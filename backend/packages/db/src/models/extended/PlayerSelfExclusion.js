'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 163 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One self-exclusion (break) a player put on themselves — see migration 163. */
class PlayerSelfExclusion extends Model {}

module.exports = (sequelize) => {
  PlayerSelfExclusion.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      /** CASINO | SPORTS | PLATFORM. */
      type: { type: DataTypes.STRING(10), allowNull: false, field: 'type' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      until_at: { type: DataTypes.DATE, allowNull: false, field: 'until_at' },
      /** Only on the 24-hour cooldown that opens the flow. */
      cooldown_until_at: { type: DataTypes.DATE, allowNull: true, field: 'cooldown_until_at' },
    },
    {
      sequelize,
      modelName: 'PlayerSelfExclusion',
      tableName: 'player_self_exclusions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
      indexes: [{ name: 'idx_player_self_exclusions_user', fields: ['user_id', 'until_at'] }],
    }
  );

  return PlayerSelfExclusion;
};
