'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// Database CHECK constraints on this table:
//   executives_kind_check: ((kind)::text = ANY ((ARRAY['executive'::character varying, 'marketing'::character varying])::text[]))
//   executives_status_check: ((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'locked'::character varying])::text[]))
//
// Foreign keys:
//   parent_staff_id -> staff(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class Executives extends Model {}

module.exports = (sequelize) => {
  Executives.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    username: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: "executives_username_key",
      field: "username",
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "password",
    },
    parent_staff_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "staff", key: "id" },
      onDelete: "CASCADE",
      field: "parent_staff_id",
    },
    parent_role_snapshot: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "parent_role_snapshot",
    },
    permissions: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "permissions",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "active",
      field: "status",
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_login",
    },
    last_login_ip: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "last_login_ip",
    },
    kind: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "executive",
      field: "kind",
    },
  }, {
    sequelize,
    modelName: "Executives",
    tableName: "executives",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_executives_kind",
        fields: ["kind"],
      },
      {
        name: "idx_executives_parent_staff_id",
        fields: ["parent_staff_id"],
      },
      {
        name: "idx_executives_username",
        fields: ["username"],
      },
    ],
  });

  return Executives;
};
