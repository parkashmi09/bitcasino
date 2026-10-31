'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class UserExposures extends Model {}

module.exports = (sequelize) => {
  UserExposures.init({
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
    match_id: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "match_id",
    },
    team_name: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "team_name",
    },
    exposure_amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "exposure_amount",
    },
    match_title: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "match_title",
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "category",
    },
    event_id: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "event_id",
    },
    game_type: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "game_type",
    },
  }, {
    sequelize,
    modelName: "UserExposures",
    tableName: "user_exposures",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "user_exposures_user_id_match_id_team_name_game_type",
        fields: ["user_id", "match_id", "team_name", "game_type"],
        unique: true,
      },
    ],
  });

  return UserExposures;
};
