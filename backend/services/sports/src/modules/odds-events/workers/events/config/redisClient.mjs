// config/redisClient.js — mssports events worker, moved unchanged

import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();
var redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || void 0,
  // undefined means no password
  db: process.env.REDIS_DB || 1,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2e3);
    return delay;
  }
});
redis.on("connect", () => {
  console.log("\u2705 Connected to Redis");
});
redis.on("error", (err) => {
  console.error("\u274C Redis Connection Error:", err);
});
var redisClient_default = redis;

export { redisClient_default };
