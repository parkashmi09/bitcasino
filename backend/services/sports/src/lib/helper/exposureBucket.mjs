// helper/exposureBucket.js — mssports core, moved unchanged
import { isLineMarket } from "./lineMarket.mjs";

var PER_SELECTION_MARKETS = /* @__PURE__ */ new Set([
  "Normal",
  "Ball By Ball",
  "Over By Over",
  "khado",
  "meter",
  "fancy1",
  "oddeven",
  "badlo"
]);
var isPerSelectionMarket = (marketType) => PER_SELECTION_MARKETS.has(String(marketType || "")) || isLineMarket(marketType);
var selectionExposureRows = (sel) => [sel, `${sel}lay`, `${sel}back`, `${sel}totalstake`];
var isHelperExposureRow = (teamName) => /(?:lay|back|totalstake)$/i.test(String(teamName || ""));
var releasableLiability = (exposures, { perSelection, sel } = {}) => {
  if (perSelection) {
    const base = exposures.find((e) => e.team_name === sel);
    return Math.min(0, parseFloat(base?.exposure_amount || 0));
  }
  return exposures.reduce(
    (min, e) => Math.min(min, parseFloat(e.exposure_amount || 0)),
    0
  );
};
var additiveBucketLiability = (exposures) => exposures.reduce((sum, e) => {
  if (isHelperExposureRow(e.team_name)) return sum;
  const val = parseFloat(e.exposure_amount || 0);
  return val < 0 ? sum + val : sum;
}, 0);
var SETTLED_RESULT_STATUSES = ["won", "loss", "lost"];

export { isPerSelectionMarket, selectionExposureRows, releasableLiability, additiveBucketLiability, SETTLED_RESULT_STATUSES };
