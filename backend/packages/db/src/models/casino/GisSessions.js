'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GisSessions extends Model {}

module.exports = (sequelize) => {
  GisSessions.init({
    id: {
      type: DataTypes.BIGINT,
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
    session_id: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "gis_sessions_session_id_key",
      field: "session_id",
    },
    game_uuid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "game_uuid",
    },
    currency: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "currency",
    },
    device: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "device",
    },
    return_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "return_url",
    },
    language: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "language",
    },
    lobby_data: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "lobby_data",
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "ended_at",
    },
  }, {
    sequelize,
    modelName: "GisSessions",
    tableName: "gis_sessions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return GisSessions;
};
