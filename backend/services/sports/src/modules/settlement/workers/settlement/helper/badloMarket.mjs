// helper/badloMarket.js — mssports settlement worker, moved unchanged

var isBadloBet = (bet) => bet?.badlo === true || String(bet?.badlo) === "true";
var isYesSide2 = (betType) => ["yes", "back"].includes(String(betType || "").toLowerCase());
function badloPnl({ runs, line, stake, betType }) {
  if (Number(runs) !== Number(line)) return 0;
  const signed = (isYesSide2(betType) ? 1 : -1) * Number(stake);
  return signed === 0 ? 0 : signed;
}

export { isBadloBet, badloPnl };
