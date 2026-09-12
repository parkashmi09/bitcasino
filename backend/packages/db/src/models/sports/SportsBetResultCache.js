'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class SportsBetResultCache extends Model {}

module.exports = (sequelize) => {
  SportsBetResultCache.init({
    user_id: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "user_id",
    },
    eventid: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "eventid",
    },
    match_id: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "match_id",
    },
    bucket: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "bucket",
    },
    declared: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "declared",
    },
    is_match_over: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_match_over",
    },
    winner_name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "winner_name",
    },
    winner_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "winner_id",
    },
    market_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "market_id",
    },
    market_name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "market_name",
    },
    provider: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "provider",
    },
    betting_type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "betting_type",
    },
    declared_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "declared_at",
    },
    api_snapshot: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "api_snapshot",
    },
    recorded_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "recorded_at",
    },
  }, {
    sequelize,
    modelName: "SportsBetResultCache",
    tableName: "sports_bet_result_cache",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return SportsBetResultCache;
};
