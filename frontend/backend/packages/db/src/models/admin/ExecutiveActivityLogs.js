'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// Database CHECK constraints on this table:
//   executive_activity_logs_status_check: ((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[]))
//
// Foreign keys:
//   executive_id -> executives(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class ExecutiveActivityLogs extends Model {}

module.exports = (sequelize) => {
  ExecutiveActivityLogs.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    executive_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "executives", key: "id" },
      onDelete: "CASCADE",
      field: "executive_id",
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
      type: DataTypes.STRING(40),
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
    modelName: "ExecutiveActivityLogs",
    tableName: "executive_activity_logs",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_exec_activity_action",
        fields: ["action"],
      },
      {
        name: "idx_exec_activity_executive_created",
        fields: ["executive_id", "created_at"],
      },
    ],
  });

  return ExecutiveActivityLogs;
};
