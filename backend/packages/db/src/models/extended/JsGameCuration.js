'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 040.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One curated, ordered list of `js_games`, addressed by `(scope, key)`.
 *
 * `scope` is what kind of list it is — a vendor's, a game type's, or a named
 * collection such as `trending`. `key` is which one. See migration 040 for why
 * this is one table rather than the seven the aggregator side grew, and why it
 * stores `game_uid` rather than `js_games.id`.
 */
class JsGameCuration extends Model {}

module.exports = (sequelize) => {
  JsGameCuration.init(
    {
      scope: { type: DataTypes.STRING(20), primaryKey: true, allowNull: false, field: 'scope' },
      key: { type: DataTypes.STRING(190), primaryKey: true, allowNull: false, field: 'key' },
      /** Ordered CSV of `js_games.game_uid`. Empty string when curated to nothing. */
      game_uids: { type: DataTypes.TEXT, allowNull: false, defaultValue: '', field: 'game_uids' },
      updated_by: { type: DataTypes.STRING(190), allowNull: true, field: 'updated_by' },
    },
    {
      sequelize,
      modelName: 'JsGameCuration',
      tableName: 'js_game_curation',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return JsGameCuration;
};
