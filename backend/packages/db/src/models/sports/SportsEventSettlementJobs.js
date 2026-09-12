'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class SportsEventSettlementJobs extends Model {}

module.exports = (sequelize) => {
  SportsEventSettlementJobs.init({
    job_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      field: "job_id",
    },
    user_id: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "user_id",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "eventid",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "queued",
      field: "status",
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: "5",
      field: "priority",
    },
    run_after: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "run_after",
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "payload",
    },
    error_msg: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "error_msg",
    },
    bet_type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bet_type",
    },
    bet_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bet_id",
    },
  }, {
    sequelize,
    modelName: "SportsEventSettlementJobs",
    tableName: "sports_event_settlement_jobs",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "settlement_jobs_unique",
        fields: ["user_id", "eventid", "bet_id"],
        unique: true,
      },
    ],
  });

  return SportsEventSettlementJobs;
};
