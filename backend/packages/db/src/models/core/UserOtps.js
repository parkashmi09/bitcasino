'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// Foreign keys:
//   email -> users(email) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class UserOtps extends Model {}

module.exports = (sequelize) => {
  UserOtps.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    email: {
      type: DataTypes.TEXT,
      allowNull: false,
      references: { model: "users", key: "email" },
      onDelete: "CASCADE",
      field: "email",
    },
    otp_hash: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "otp_hash",
    },
    purpose: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "purpose",
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "0",
      field: "attempts",
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "expires_at",
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "is_verified",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "user_id",
    },
  }, {
    sequelize,
    modelName: "UserOtps",
    tableName: "user_otps",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return UserOtps;
};
