'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 038.
// Domain: extended — written and read by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One game a player has starred.
 *
 * `game_ref` is opaque on purpose — the two catalogues here key on different
 * columns (`gisgamesnew.uuid`, `js_games.game_uid`) and the client has a slug
 * of its own, so the reference is stored as given and resolved on read. The
 * argument in full, including why this is not a foreign key, is at the head of
 * migration 038.
 */
class UserFavouriteGames extends Model {}

module.exports = (sequelize) => {
  UserFavouriteGames.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      /** A uuid, a game_uid or a client slug. Resolved against both catalogues on read. */
      game_ref: { type: DataTypes.STRING(190), allowNull: false, field: 'game_ref' },
      /** Which catalogue the client believed it was naming. 'unknown' is allowed and is the default. */
      source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'unknown', field: 'source' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'UserFavouriteGames',
      tableName: 'user_favourite_games',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
      indexes: [
        { name: 'user_favourite_games_user_ref_uniq', fields: ['user_id', 'game_ref'], unique: true },
        { name: 'idx_user_favourite_games_user', fields: ['user_id', 'created_at'] },
      ],
    }
  );

  return UserFavouriteGames;
};
