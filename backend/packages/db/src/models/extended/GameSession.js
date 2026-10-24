'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 016.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A jsGamesv2 launch session.
 *
 * RECONSTRUCTED. `game_sessions` was referenced by `POST /jsGamesv2/launch` and
 * never existed, so every launch created a session at the provider and then
 * returned 500 when it tried to record one here. See migration 016.
 */
class GameSession extends Model {}

module.exports = (sequelize) => {
  GameSession.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      game_uid: { type: DataTypes.STRING(190), allowNull: false, field: 'game_uid' },
      /**
       * The provider's token. It is the only thing that ties a later callback
       * back to the player who opened the game, which is why it is unique.
       */
      session_token: { type: DataTypes.STRING(190), allowNull: false, field: 'session_token' },
      launch_url: { type: DataTypes.TEXT, allowNull: true, field: 'launch_url' },
    },
    {
      sequelize,
      modelName: 'GameSession',
      tableName: 'game_sessions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return GameSession;
};
