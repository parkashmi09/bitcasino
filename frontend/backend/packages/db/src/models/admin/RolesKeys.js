'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)

const { Model, DataTypes } = require('sequelize');

class RolesKeys extends Model {}

module.exports = (sequelize) => {
  RolesKeys.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    role_key: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "roles_keys_role_key_key",
      field: "role_key",
    },
    role: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "role",
    },
  }, {
    sequelize,
    modelName: "RolesKeys",
    tableName: "roles_keys",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return RolesKeys;
};
