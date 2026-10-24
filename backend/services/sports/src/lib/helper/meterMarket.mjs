// helper/meterMarket.js — mssports core, moved unchanged

var METER_MAX_RUNS = 150;
var isMeterMarket = (marketType) => ["meter", "meters"].includes(String(marketType || "").toLowerCase());
var isYesSide = (betType) => ["yes", "back"].includes(String(betType || "").toLowerCase());
function meterPnl({ runs, line, stake, betType }) {
  const capped = Math.min(Number(runs), Number(line) + METER_MAX_RUNS);
  const diff = (capped - Number(line)) * Number(stake);
  const signed = isYesSide(betType) ? diff : -diff;
  return signed === 0 ? 0 : signed;
}
function meterLiability({ line, stake, betType }) {
  return isYesSide(betType) ? Number(line) * Number(stake) : METER_MAX_RUNS * Number(stake);
}

export { METER_MAX_RUNS, isMeterMarket, meterPnl, meterLiability };
