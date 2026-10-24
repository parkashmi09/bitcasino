// helper/badloMarket.js — mssports core, moved unchanged

var isBadloBet = (bet) => bet?.badlo === true || String(bet?.badlo) === "true";
var BADLO_EXPOSURE_GAME_TYPE = "badlo";
var isYesSide3 = (betType) => ["yes", "back"].includes(String(betType || "").toLowerCase());
function badloPnl({ runs, line, stake, betType }) {
  if (Number(runs) !== Number(line)) return 0;
  const signed = (isYesSide3(betType) ? 1 : -1) * Number(stake);
  return signed === 0 ? 0 : signed;
}
function badloLiability({ stake, betType }) {
  return isYesSide3(betType) ? 0 : Number(stake);
}

export { isBadloBet, BADLO_EXPOSURE_GAME_TYPE, badloPnl, badloLiability };
