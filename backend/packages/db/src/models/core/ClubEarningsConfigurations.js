'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class ClubEarningsConfigurations extends Model {}

module.exports = (sequelize) => {
  ClubEarningsConfigurations.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    club_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "club_id",
    },
    configuration_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "configuration_type",
    },
    owner_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: "10.0",
      field: "owner_percentage",
    },
    agent_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: "20.0",
      field: "agent_percentage",
    },
    member_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: "5.0",
      field: "member_percentage",
    },
    active_player_threshold: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "5",
      field: "active_player_threshold",
    },
    wager_threshold: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: "200.0",
      field: "wager_threshold",
    },
  }, {
    sequelize,
    modelName: "ClubEarningsConfigurations",
    tableName: "club_earnings_configurations",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return ClubEarningsConfigurations;
};
