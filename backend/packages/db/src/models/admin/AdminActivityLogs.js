'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// Database CHECK constraints on this table:
//   admin_activity_logs_status_check: ((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[]))
//
// Foreign keys:
//   executive_id -> executives(id) ON DELETE SET NULL
//   staff_id -> staff(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class AdminActivityLogs extends Model {}

module.exports = (sequelize) => {
  AdminActivityLogs.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    staff_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "staff", key: "id" },
      onDelete: "CASCADE",
      field: "staff_id",
    },
    executive_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "executives", key: "id" },
      onDelete: "SET NULL",
      field: "executive_id",
    },
    actor_name: {
      type: DataTypes.STRING(120),
      allowNull: true,
      field: "actor_name",
    },
    actor_role: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "actor_role",
    },
    actor_level: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "actor_level",
    },
    action: {
      type: DataTypes.STRING(80),
      allowNull: false,
      field: "action",
    },
    target_type: {
      type: DataTypes.STRING(40),
      allowNull: true,
      field: "target_type",
    },
    target_id: {
      type: DataTypes.STRING(60),
      allowNull: true,
      field: "target_id",
    },
    details: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "details",
    },
    ip: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: "ip",
    },
    country: {
      type: DataTypes.STRING(80),
      allowNull: true,
      field: "country",
    },
    region: {
      type: DataTypes.STRING(80),
      allowNull: true,
      field: "region",
    },
    city: {
      type: DataTypes.STRING(120),
      allowNull: true,
      field: "city",
    },
    user_agent: {
      type: DataTypes.STRING(512),
      allowNull: true,
      field: "user_agent",
    },
    status: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "success",
      field: "status",
    },
    error_message: {
      type: DataTypes.STRING(512),
      allowNull: true,
      field: "error_message",
    },
  }, {
    sequelize,
    modelName: "AdminActivityLogs",
    tableName: "admin_activity_logs",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_admin_activity_action",
        fields: ["action"],
      },
      {
        name: "idx_admin_activity_created",
        fields: ["created_at"],
      },
      {
        name: "idx_admin_activity_executive_created",
        fields: ["executive_id", "created_at"],
      },
      {
        name: "idx_admin_activity_staff_created",
        fields: ["staff_id", "created_at"],
      },
    ],
  });

  return AdminActivityLogs;
};
