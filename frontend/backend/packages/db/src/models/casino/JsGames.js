'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class JsGames extends Model {}

module.exports = (sequelize) => {
  JsGames.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    game_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "game_name",
    },
    game_uid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: "js_games_game_uid_key",
      field: "game_uid",
    },
    game_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "game_type",
    },
    game_icon: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: "game_icon",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "is_active",
    },
    vendor: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "vendor",
    },
  }, {
    sequelize,
    modelName: "JsGames",
    tableName: "js_games",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return JsGames;
};
