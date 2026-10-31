// config/db.js — mssports results worker, moved; adds the schema search_path (see dialectOptions)

import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });
var IS_API_PROCESS = path.basename(process.env.pm_exec_path || process.argv[1] || "") === "server.js";
var POOL_MAX = Number(process.env.DB_POOL_MAX) || (IS_API_PROCESS ? 25 : 10);
var sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    // Added on the move: mssports' tables live in their own schema (packages/db migration
    // 094-mssports-schema), reached through search_path on THIS pool only.
    dialectOptions: { options: `-c search_path=${process.env.MSSPORTS_DB_SCHEMA || "mssports"},public` },
    logging: false,
    // set to true for SQL logs
    pool: {
      max: POOL_MAX,
      // max connections in pool (see POOL_MAX above)
      min: 2,
      // min connections kept open
      acquire: 3e4,
      // max ms to wait for a connection before throwing error
      idle: 1e4,
      // max ms a connection can be idle before being released
      evict: 1e3
      // how often to check for idle connections (ms)
    }
  }
);
var db_default = sequelize;

export { db_default };
