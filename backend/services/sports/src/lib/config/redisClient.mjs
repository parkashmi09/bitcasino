// config/redisClient.js — mssports core, moved unchanged
import { __esm, __export } from "../esbuildRuntime.mjs";

var redisClient_exports = {};
__export(redisClient_exports, {
  default: () => redisClient_default
});
import Redis from "ioredis";
import dotenv2 from "dotenv";
var redis, redisClient_default;
var init_redisClient = __esm({
  "config/redisClient.js"() {
    dotenv2.config();
    redis = new Redis({
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
    redisClient_default = redis;
  }
});

export { redisClient_exports, redisClient_default, init_redisClient };
