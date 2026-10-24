// helper/exposureBucket.js — mssports settlement worker, moved unchanged
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

export { isPerSelectionMarket, selectionExposureRows };
