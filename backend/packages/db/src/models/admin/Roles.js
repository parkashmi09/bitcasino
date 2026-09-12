'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)

const { Model, DataTypes } = require('sequelize');

class Roles extends Model {}

module.exports = (sequelize) => {
  Roles.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: "roles_name_key",
      field: "name",
    },
    level: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "level",
    },
    responsibilities: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "responsibilities",
    },
  }, {
    sequelize,
    modelName: "Roles",
    tableName: "roles",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Roles;
};
