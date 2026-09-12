'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GisRecentlyPlayed extends Model {}

module.exports = (sequelize) => {
  GisRecentlyPlayed.init({
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
    game_uuid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "game_uuid",
    },
    played_at: {
      type: 'TIMESTAMP',
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "played_at",
    },
  }, {
    sequelize,
    modelName: "GisRecentlyPlayed",
    tableName: "gis_recently_played",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
    indexes: [
      {
        name: "gis_recently_played_user_played_idx",
        fields: ["user_id", "played_at"],
      },
      {
        name: "gis_recently_played_user_game_uniq",
        fields: ["user_id", "game_uuid"],
        unique: true,
      },
    ],
  });

  return GisRecentlyPlayed;
};
