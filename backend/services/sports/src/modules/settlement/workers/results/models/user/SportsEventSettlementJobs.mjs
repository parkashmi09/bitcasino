// model/user/SportsEventSettlementJobs.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes3 } from "sequelize";
var SportsEventSettlementJob = db_default.define(
  "SportsEventSettlementJob",
  {
    job_id: {
      type: DataTypes3.UUID,
      defaultValue: DataTypes3.UUIDV4,
      primaryKey: true
    },
    user_id: {
      type: DataTypes3.TEXT,
      allowNull: false
    },
    eventid: {
      type: DataTypes3.TEXT,
      allowNull: false
    },
    status: {
      type: DataTypes3.TEXT,
      allowNull: false,
      defaultValue: "queued"
    },
    priority: {
      type: DataTypes3.INTEGER,
      allowNull: false,
      defaultValue: 5
    },
    run_after: {
      type: DataTypes3.DATE,
      allowNull: false,
      defaultValue: DataTypes3.NOW
    },
    payload: {
      type: DataTypes3.JSONB,
      allowNull: false
    },
    error_msg: {
      type: DataTypes3.TEXT,
      allowNull: true
    },
    created_at: {
      type: DataTypes3.DATE,
      allowNull: false,
      defaultValue: DataTypes3.NOW
    },
    updated_at: {
      type: DataTypes3.DATE,
      allowNull: false,
      defaultValue: DataTypes3.NOW
    },
    bet_type: {
      type: DataTypes3.TEXT,
      allowNull: true
    },
    bet_id: {
      type: DataTypes3.TEXT,
      allowNull: true
    }
  },
  {
    tableName: "sports_event_settlement_jobs",
    timestamps: false,
    indexes: [
      {
        // this MUST match your conflictFields and be unique
        unique: true,
        fields: ["user_id", "eventid", "bet_id"],
        name: "uniq_user_event_bet"
      },
      {
        fields: ["status"]
      }
    ]
  }
);
var SportsEventSettlementJobs_default = SportsEventSettlementJob;

export { SportsEventSettlementJobs_default };
