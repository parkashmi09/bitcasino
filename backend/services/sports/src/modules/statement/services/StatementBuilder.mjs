// services/statement/StatementBuilder.js — mssports core, moved unchanged
import { isMeterMarket } from "../../../lib/helper/meterMarket.mjs";
import { isLineMarket } from "../../../lib/helper/lineMarket.mjs";
import { isBadloBet } from "../../../lib/helper/badloMarket.mjs";
import { CreditsLedger_default } from "../../../models/user/CreditsLedger.mjs";
import { sportsDataSet2 } from "../../../lib/utils/sportsNames.mjs";

import { Op as Op8 } from "sequelize";
var SPORT_NAMES = {
  ...Object.fromEntries(sportsDataSet2.map((s) => [String(s.sid), s.name])),
  "1": "Football",
  "2": "Tennis",
  "4": "Cricket",
  "7": "Horse Racing",
  "10": "Horse Racing",
  "65": "Greyhound Racing",
  "1477": "Kabaddi"
};
function sportsNet(b, ledgerNet = null) {
  const stake = parseFloat(b.stake_amount) || 0;
  const liab = parseFloat(b.liability) || 0;
  const odds = parseFloat(b.odds) || 0;
  const size = parseFloat(b.size) || 0;
  const bt = String(b.bet_type || "").toLowerCase();
  const gt = String(b.game_type || "").toUpperCase();
  const mt = String(b.market_type || "").toLowerCase();
  const res = String(b.result_status || "").toLowerCase();
  const isBack = bt === "back" || bt === "yes";
  const isLay = bt === "lay" || bt === "no";
  const netFromLedger = gt === "FAN" && (isMeterMarket(b.market_type) || isBadloBet(b) || mt === "oddeven" || mt === "fancy1");
  if (netFromLedger && ledgerNet != null && Number.isFinite(Number(ledgerNet))) {
    return Math.round(Number(ledgerNet) * 100) / 100;
  }
  let pl = 0;
  if (res === "won") {
    if (isBack) {
      if (gt === "BM") pl = stake * (odds / 100);
      else if (mt === "tied match") pl = stake * (odds / 100);
      else if (gt === "FAN") {
        if (mt === "fancy1") pl = stake;
        else if (isLineMarket(b.market_type)) pl = stake;
        else pl = size > 0 ? stake * (size / 100) : stake * (odds / 100);
      } else pl = stake * (odds - 1);
    } else if (isLay) {
      pl = stake;
    }
  } else if (res === "loss") {
    if (isBack) pl = -stake;
    else if (isLay) pl = -liab;
  }
  return pl;
}
async function loadFanSettlementNet(userId, bets) {
  const ids = (bets || []).filter((b) => String(b.game_type || "").toUpperCase() === "FAN").map((b) => b.id).filter((id) => id != null);
  if (!ids.length) return /* @__PURE__ */ new Map();
  const rows = await CreditsLedger_default.findAll({
    where: {
      ...userId != null ? { user_id: String(userId) } : {},
      reason: "settlement",
      bet_id: { [Op8.in]: ids },
      netamount: { [Op8.ne]: null }
    },
    attributes: ["id", "bet_id", "netamount"],
    order: [["id", "ASC"]],
    raw: true
  });
  const out = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const k = String(r.bet_id);
    if (!out.has(k)) out.set(k, r.netamount);
  }
  return out;
}

export { SPORT_NAMES, sportsNet, loadFanSettlementNet };
