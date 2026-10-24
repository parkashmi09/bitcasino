'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GisGameDeletionAudit extends Model {}

module.exports = (sequelize) => {
  GisGameDeletionAudit.init({
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
      field: "uuid",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "name",
    },
    blocked_by: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "blocked_by",
    },
    ref_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "ref_count",
    },
    skipped_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "skipped_at",
    },
    api_checked_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "api_checked_at",
    },
  }, {
    sequelize,
    modelName: "GisGameDeletionAudit",
    tableName: "gis_game_deletion_audit",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return GisGameDeletionAudit;
};
