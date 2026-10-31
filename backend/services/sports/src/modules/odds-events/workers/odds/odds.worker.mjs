// sportsMain/cron/odds.js — mssports odds worker, moved unchanged
import { sidArray } from "./config/sid.mjs";
import { redisClient_default } from "./config/redisClient.mjs";
import { fetchSportsData } from "./helper/apihelper.mjs";

var INTERVAL_SECONDS = 2;
var REDIS_TTL = 3;
var isRunning = false;
var runAllEventsCron = async () => {
  if (isRunning) return;
  const startTime = Date.now();
  isRunning = true;
  try {
    const activeSports = sidArray.filter((sport) => sport.active);
    const getMatchesPromises = activeSports.map(async (sport) => {
      const sportId = sport.eid;
      try {
        const cachedMatches = await redisClient_default.get(`alleventss:${sportId}`);
        if (!cachedMatches) return { sportId, matches: [] };
        const cached = JSON.parse(cachedMatches);
        // The events worker (and CricketService) store { t1, t2, t3 }, not a bare array.
        const matches = Array.isArray(cached) ? cached : [...cached?.t1 ?? [], ...cached?.t2 ?? [], ...cached?.t3 ?? []];
        const gmids = [
          ...new Set(
            matches.filter((match) => match && match.gmid).map((match) => match.gmid)
          )
        ];
        return { sportId, gmids };
      } catch (err) {
        console.error(`\u274C Redis get failed for sport ${sportId}:`, err.message);
        return { sportId, gmids: [] };
      }
    });
    const sportsWithGmids = await Promise.all(getMatchesPromises);
    const allOddsPromises = [];
    sportsWithGmids.forEach(({ sportId, gmids }) => {
      if (!gmids || gmids.length === 0) return;
      gmids.forEach((gmid) => {
        const promise = (async () => {
          const endpoint = `/gamedataPrivate?etid=${sportId}&gmid=${gmid}`;
          try {
            const response = await fetchSportsData(endpoint);
            // The old mirror answered { data: [...] }; AVRKHUB answers { data: { data: [...] } }.
            const oddsData = Array.isArray(response?.data) ? response.data : response?.data?.data || {};
            if (Array.isArray(oddsData) && oddsData.length > 0) {
              await redisClient_default.setex(
                `oddss:${gmid}`,
                REDIS_TTL,
                JSON.stringify(oddsData)
              );
              return { sportId, gmid, success: true, hasData: true };
            }
            return { sportId, gmid, success: true, hasData: false };
          } catch (err) {
            console.error(
              `\u274C Odds API failed for ${sportId}:${gmid}:`,
              err.message
            );
            return { sportId, gmid, success: false, error: err.message };
          }
        })();
        allOddsPromises.push(promise);
      });
    });
    const oddsResults = await Promise.allSettled(allOddsPromises);
    const totalGmids = allOddsPromises.length;
    const successful = oddsResults.filter(
      (r) => r.status === "fulfilled" && r.value.success
    );
    const withData = oddsResults.filter(
      (r) => r.status === "fulfilled" && r.value.success && r.value.hasData
    );
    const failed = oddsResults.filter(
      (r) => r.status === "rejected" || !r.value?.success
    );
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    console.log(
      `\u26A1 ${totalGmids} matches processed in ${processingTime}ms | \u2705 ${successful.length} success (${withData.length} with odds) | \u274C ${failed.length} failed`
    );
    if (processingTime > 1800) {
      console.warn(
        `\u26A0\uFE0F Processing took ${processingTime}ms - slower than 1.8 second interval!`
      );
    }
  } catch (err) {
    console.error("\u274C Cron error:", err.message);
  } finally {
    isRunning = false;
  }
};
runAllEventsCron();
setInterval(runAllEventsCron, INTERVAL_SECONDS * 1e3);
