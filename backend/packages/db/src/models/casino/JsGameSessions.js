'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class JsGameSessions extends Model {}

module.exports = (sequelize) => {
  JsGameSessions.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    game_uid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "game_uid",
    },
    session_token: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: "js_game_sessions_session_token_key",
      field: "session_token",
    },
    launch_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "launch_url",
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "active",
      field: "status",
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "started_at",
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "ended_at",
    },
  }, {
    sequelize,
    modelName: "JsGameSessions",
    tableName: "js_game_sessions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
    indexes: [
      {
        name: "idx_game_sessions_game",
        fields: ["game_uid"],
      },
      {
        name: "idx_game_sessions_user",
        fields: ["user_id"],
      },
    ],
  });

  return JsGameSessions;
};
