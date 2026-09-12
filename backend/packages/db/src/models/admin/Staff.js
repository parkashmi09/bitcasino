'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// Foreign keys:
//   parent_id -> staff(id)
//   role_id -> roles(id)

const { Model, DataTypes } = require('sequelize');

class Staff extends Model {}

module.exports = (sequelize) => {
  Staff.init({
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
    email: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "staff_email_key",
      field: "email",
    },
    password: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "password",
    },
    password2: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "password2",
    },
    phone: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "phone",
    },
    country: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "country",
    },
    role_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "roles", key: "id" },
      field: "role_id",
    },
    parent_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "staff", key: "id" },
      field: "parent_id",
    },
    percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: "0",
      field: "percentage",
    },
    agent_code: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: "staff_agent_code_uidx",
      field: "agent_code",
    },
    system_locked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "system_locked",
    },
    first_login: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "first_login",
    },
    transaction_password: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "transaction_password",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "active",
      field: "status",
    },
    bet_status: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "active",
      field: "bet_status",
    },
    sports_betlocked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "sports_betlocked",
    },
    casino_locked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "casino_locked",
    },
  }, {
    sequelize,
    modelName: "Staff",
    tableName: "staff",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return Staff;
};
