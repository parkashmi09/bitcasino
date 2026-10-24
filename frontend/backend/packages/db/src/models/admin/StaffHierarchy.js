'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// Foreign keys:
//   ancestor_id -> staff(id) ON DELETE CASCADE
//   descendant_id -> staff(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class StaffHierarchy extends Model {}

module.exports = (sequelize) => {
  StaffHierarchy.init({
    ancestor_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      references: { model: "staff", key: "id" },
      onDelete: "CASCADE",
      field: "ancestor_id",
    },
    descendant_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      references: { model: "staff", key: "id" },
      onDelete: "CASCADE",
      field: "descendant_id",
    },
    depth: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "depth",
    },
  }, {
    sequelize,
    modelName: "StaffHierarchy",
    tableName: "staff_hierarchy",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return StaffHierarchy;
};
