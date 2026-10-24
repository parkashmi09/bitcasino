'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Clubs extends Model {}

module.exports = (sequelize) => {
  Clubs.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "name",
    },
    owner_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "owner_id",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "description",
    },
    avatar: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "avatar",
    },
    max_members: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "50",
      field: "max_members",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "is_active",
    },
    unique_club_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "unique_club_id",
    },
    profile_picture: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "profile_picture",
    },
    owner_earnings_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: "10.0",
      field: "owner_earnings_percentage",
    },
    agent_earnings_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: "20.0",
      field: "agent_earnings_percentage",
    },
    min_active_players_threshold: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "5",
      field: "min_active_players_threshold",
    },
    active_player_wager_threshold: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: "200.0",
      field: "active_player_wager_threshold",
    },
    member_earnings_percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: "5.0",
      field: "member_earnings_percentage",
    },
    parent_club_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "parent_club_id",
    },
    clubrake: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "10",
      field: "clubrake",
    },
  }, {
    sequelize,
    modelName: "Clubs",
    tableName: "clubs",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return Clubs;
};
