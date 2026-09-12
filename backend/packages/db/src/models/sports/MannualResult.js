'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class MannualResult extends Model {}

module.exports = (sequelize) => {
  MannualResult.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "eventid",
    },
    match_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "match_id",
    },
    match_title: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "match_title",
    },
    game_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "game_type",
    },
    market_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "market_type",
    },
    winnerName: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "winnerName",
    },
    winnerId: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "winnerId",
    },
    fancyName: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "fancyName",
    },
  }, {
    sequelize,
    modelName: "MannualResult",
    tableName: "mannual_result",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_mannual_result_lookup",
        fields: ["eventid", "match_id", "game_type", "market_type", "created_at"],
      },
    ],
  });

  return MannualResult;
};
