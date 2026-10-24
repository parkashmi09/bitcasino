'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class User2fa extends Model {}

module.exports = (sequelize) => {
  User2fa.init({
    uid: {
      type: DataTypes.STRING(255),
      primaryKey: true,
      allowNull: false,
      field: "uid",
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "is_enabled",
    },
    secret_key: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "secret_key",
    },
  }, {
    sequelize,
    modelName: "User2fa",
    tableName: "user_2fa",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return User2fa;
};
