// model/user/SportsEventSettlementJobs.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes32 } from "sequelize";
var SportsEventSettlementJob = db_default.define(
  "SportsEventSettlementJob",
  {
    job_id: {
      type: DataTypes32.UUID,
      defaultValue: DataTypes32.UUIDV4,
      primaryKey: true
    },
    user_id: {
      type: DataTypes32.TEXT,
      allowNull: false
    },
    eventid: {
      type: DataTypes32.TEXT,
      allowNull: false
    },
    status: {
      type: DataTypes32.TEXT,
      allowNull: false,
      defaultValue: "queued"
    },
    priority: {
      type: DataTypes32.INTEGER,
      allowNull: false,
      defaultValue: 5
    },
    run_after: {
      type: DataTypes32.DATE,
      allowNull: false,
      defaultValue: DataTypes32.NOW
    },
    payload: {
      type: DataTypes32.JSONB,
      allowNull: false
    },
    error_msg: {
      type: DataTypes32.TEXT,
      allowNull: true
    },
    created_at: {
      type: DataTypes32.DATE,
      allowNull: false,
      defaultValue: DataTypes32.NOW
    },
    updated_at: {
      type: DataTypes32.DATE,
      allowNull: false,
      defaultValue: DataTypes32.NOW
    },
    bet_type: {
      type: DataTypes32.TEXT,
      allowNull: true
    },
    bet_id: {
      type: DataTypes32.TEXT,
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
