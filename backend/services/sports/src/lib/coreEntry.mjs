// core-entry.js — mssports core, moved unchanged
import { init_db } from "./config/db.mjs";
import { init_redisClient } from "./config/redisClient.mjs";

init_redisClient();
init_db();
