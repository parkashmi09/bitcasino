'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)

const { Model, DataTypes } = require('sequelize');

class AdminConfigurations extends Model {}

module.exports = (sequelize) => {
  AdminConfigurations.init({
    config_id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "config_id",
    },
    config_key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: "admin_configurations_config_key_key",
      field: "config_key",
    },
    config_value: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "config_value",
    },
    last_updated: {
      type: 'TIMESTAMP',
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "last_updated",
    },
  }, {
    sequelize,
    modelName: "AdminConfigurations",
    tableName: "admin_configurations",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return AdminConfigurations;
};
