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

// placeBet also treats the legacy market_type 'badlo' as badlo, so every guard must too.
var isBadloLeg = (bet) => isBadloBet(bet) || String(bet?.market_type || "").toLowerCase() === "badlo";
// A yes leg risks nothing on its own (badloLiability 0), so a slip is accepted only when
// its no legs fund it: at least one no, one currency, and yes stake <= no stake.
function badloSlipError(legs) {
  const badlo = legs.filter(isBadloLeg);
  if (!badlo.length) return null;
  if (badlo.length !== legs.length) return "A badlo slip cannot be mixed with other bets";
  const cur = (l) => String(l?.currency ?? l?.original_currency ?? "").toUpperCase();
  if (new Set(badlo.map(cur)).size !== 1) return "All badlo selections must use one currency";
  const sum = (yes) => badlo.filter((l) => isYesSide3(l?.bet_type) === yes).reduce((s, l) => s + Number(l?.stake_amount || 0), 0);
  const no = sum(false);
  if (!(no > 0) || sum(true) > no) return "A badlo yes needs a matching badlo no";
  return null;
}

export { isBadloBet, isBadloLeg, badloSlipError, BADLO_EXPOSURE_GAME_TYPE, badloPnl, badloLiability };
