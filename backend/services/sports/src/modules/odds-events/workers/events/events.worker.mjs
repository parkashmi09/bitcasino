// sportsMain/cron/allevents.js — mssports events worker, moved unchanged
import { sidArray } from "./config/sid.mjs";
import { redisClient_default } from "./config/redisClient.mjs";
import { fetchSportsData } from "./helper/apihelper.mjs";

var INTERVAL_MINUTES = 1;
var REDIS_TTL = 60 * 60 * 3;
var DELAY_BETWEEN_SPORTS = 1e3;
var isRunning = false;
var normalizeEvents = (data) => {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return {
      t1: Array.isArray(data.t1) ? data.t1 : [],
      t2: Array.isArray(data.t2) ? data.t2 : [],
      t3: Array.isArray(data.t3) ? data.t3 : []
    };
  }
  if (Array.isArray(data)) {
    return {
      t1: data.filter(
        (e) => e?.status === "OPEN" && e?.gscode === 1
      ),
      t2: data.filter(
        (e) => e?.status === "SUSPENDED" || e?.gscode === 0
      ),
      t3: data.filter(
        (e) => e?.status === "SUSPENDED" || e?.gscode === 0
      )
    };
  }
  return { t1: [], t2: [], t3: [] };
};
var runAllEventsCron = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    const activeSports = sidArray.filter((sport) => sport.active);
    for (const sport of activeSports) {
      const sportId = sport.eid;
      const endpoint = `/highlighthomePrivate?etid=${sportId}`;
      try {
        const response = await fetchSportsData(endpoint);
        const rawData = response?.data?.data;
        const { t1, t2, t3 } = normalizeEvents(rawData);
        const finalData = {
          t1,
          t2,
          t3
        };
        await redisClient_default.setex(
          `alleventss:${sportId}`,
          REDIS_TTL,
          JSON.stringify(finalData)
        );
        console.log(
          `\u2705 sportId=${sportId} | t1=${finalData.t1.length} | t2=${finalData.t2.length} | t3=${finalData.t3.length}`
        );
      } catch (err) {
        console.error(`\u274C API failed for sport ${sportId}`, err.message);
      }
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SPORTS));
    }
  } catch (err) {
    console.error("\u274C AllEvents cron error:", err.message);
  } finally {
    isRunning = false;
  }
};
runAllEventsCron();
setInterval(runAllEventsCron, INTERVAL_MINUTES * 60 * 1e3);
