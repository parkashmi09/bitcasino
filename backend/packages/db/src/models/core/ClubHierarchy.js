'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class ClubHierarchy extends Model {}

module.exports = (sequelize) => {
  ClubHierarchy.init({
    ancestor_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      field: "ancestor_id",
    },
    descendant_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      field: "descendant_id",
    },
    depth: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "0",
      field: "depth",
    },
  }, {
    sequelize,
    modelName: "ClubHierarchy",
    tableName: "club_hierarchy",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return ClubHierarchy;
};
