'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class SportsConfig extends Model {}

module.exports = (sequelize) => {
  SportsConfig.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    game_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "game_id",
    },
    game_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "game_name",
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "enabled",
    },
  }, {
    sequelize,
    modelName: "SportsConfig",
    tableName: "sports_config",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return SportsConfig;
};
