'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class RemovedPrioritizedGamesAudit extends Model {}

module.exports = (sequelize) => {
  RemovedPrioritizedGamesAudit.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    uuid: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "removed_prioritized_games_audit_uuid_key",
      field: "uuid",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "name",
    },
    provider: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "provider",
    },
    prioritized_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "prioritized_count",
    },
    first_detected: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "first_detected",
    },
    last_detected: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "last_detected",
    },
    resolved: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "resolved",
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "resolved_at",
    },
    resolution_note: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "resolution_note",
    },
  }, {
    sequelize,
    modelName: "RemovedPrioritizedGamesAudit",
    tableName: "removed_prioritized_games_audit",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return RemovedPrioritizedGamesAudit;
};
