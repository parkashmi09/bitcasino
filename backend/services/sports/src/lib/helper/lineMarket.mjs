// helper/lineMarket.js — mssports core, moved unchanged

var isLineMarket = (marketType) => /\bline$/i.test(String(marketType || "").trim());
var isYesSide2 = (betType) => ["yes", "back"].includes(String(betType || "").toLowerCase());
var lineBetWon = ({ runs, line, betType }) => isYesSide2(betType) ? Number(runs) >= Number(line) : Number(runs) < Number(line);
var linePnl = ({ runs, line, stake, betType }) => (lineBetWon({ runs, line, betType }) ? 1 : -1) * Number(stake);
var LINE_EXPOSURE_GAME_TYPE = "fancy2";
var exposureIdentity = ({ marketType, selectionName, badlo = false }) => isLineMarket(marketType) ? { game_type: LINE_EXPOSURE_GAME_TYPE, team_name: String(marketType) } : { game_type: marketType, team_name: selectionName };

export { isLineMarket, linePnl, exposureIdentity };
