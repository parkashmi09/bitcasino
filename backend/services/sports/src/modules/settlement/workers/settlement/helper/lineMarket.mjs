// helper/lineMarket.js — mssports settlement worker, moved unchanged

var isLineMarket = (marketType) => /\bline$/i.test(String(marketType || "").trim());
var LINE_EXPOSURE_GAME_TYPE = "fancy2";
var exposureIdentity = ({ marketType, selectionName, badlo = false }) => isLineMarket(marketType) ? { game_type: LINE_EXPOSURE_GAME_TYPE, team_name: String(marketType) } : { game_type: marketType, team_name: selectionName };

export { isLineMarket, exposureIdentity };
