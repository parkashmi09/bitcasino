// services/settlement/sportsCommissionService.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";
// Wallets → credits: the player's sports balance is the platform wallet, credits.inr.
// import { Wallet_default } from "../../models/admin/Wallet.mjs";
import { Credits_default } from "../../models/user/Credits.mjs";
import { CreditsLedger_default } from "../../models/user/CreditsLedger.mjs";
import { User_default } from "../../models/user/User.mjs";
import { walletService_default } from "../walletService.mjs";
import { CommissionConfig_default } from "../../models/admin/CommissionConfig.mjs";
import { leagueKeyFromName, leagueLabel } from "../../constants/commissionLeagues.mjs";
import { CommissionConfigService_default } from "../CommissionConfigService.mjs";
import { resolveLeagueName } from "../SportsLeagueResolver.mjs";

var COMMISSION_REASON = "commission";
var COMMISSION_SUFFIX = "- Comm";
var round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
async function applyWinCommission(p) {
  const log2 = p.log || console;
  try {
    const netWin = round2(p.netWin);
    if (!(netWin > 0)) return { applied: false, reason: "no net win" };
    if (!p.settlementLedgerId) return { applied: false, reason: "no settlement ledger id" };
    const bet = p.bet || {};
    const sportId = bet.sport_id ?? p.sport_id ?? null;
    const marketKey = CommissionConfig_default.marketKeyOfBet(bet);
    let leagueName = bet.league_name || null;
    if (!leagueName && (bet.eventid || p.eventid)) {
      leagueName = await resolveLeagueName(sportId, bet.eventid || p.eventid);
    }
    const leagueKey = leagueKeyFromName(sportId, leagueName);
    const rule = await CommissionConfigService_default.getRule(sportId, leagueKey, marketKey);
    if (!rule.enabled) {
      return { applied: false, reason: `cell off (${sportId}/${leagueKey}/${marketKey})` };
    }
    const comm = round2(netWin * rule.percent / 100);
    if (!(comm > 0)) return { applied: false, reason: "rounds to 0" };
    const dup = await CreditsLedger_default.findOne({
      where: {
        user_id: String(p.user_id),
        reason: COMMISSION_REASON,
        bet_id: bet.id || null
      },
      attributes: ["id", "meta"],
      raw: true
    });
    if (dup && Number(dup.meta?.commission_of_ledger_id) === Number(p.settlementLedgerId)) {
      return { applied: false, reason: `already charged (ledger ${dup.id})` };
    }
    const description = `${p.description || ""}${COMMISSION_SUFFIX}`;
    let newCash = 0, newInr = 0, ledgerId = null;
    await db_default.transaction(async (transaction) => {
      // OLD (Wallets.cash + Wallets.inr_balance):
      /*
      const wallet = await Wallet_default.findOne({
        where: { user_id: String(p.user_id) },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!wallet) throw new Error(`wallet not found for user ${p.user_id}`);
      newCash = round2(Number(wallet.cash || 0) - comm);
      newInr = round2(Number(wallet.inr_balance || 0) - comm);
      await wallet.update({ cash: newCash, inr_balance: newInr }, { transaction });
      */
      // NEW (credits.inr): the commission comes off the winnings in inr.
      const wallet = await Credits_default.findOne({
        where: { uid: p.user_id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!wallet) throw new Error(`wallet not found for user ${p.user_id}`);
      newCash = round2(Number(wallet.inr || 0) - comm);
      newInr = newCash;
      await wallet.update({ inr: newCash }, { transaction });
      await User_default.increment(
        { net_loss: -comm, profit: -comm },
        { where: { user_id: p.user_id }, transaction }
      );
      const row = await CreditsLedger_default.create({
        user_id: String(p.user_id),
        currency: "INR",
        amount: -comm,
        reason: COMMISSION_REASON,
        // So the trigger stamps bet_currency, and the duplicate check above (by bet_id) can match.
        bet_id: bet.id || null,
        description,
        eventid: p.eventid || null,
        match_id: p.match_id || null,
        job_id: p.job_id || null,
        market_type: p.market_type || null,
        sport_id: sportId != null ? String(sportId) : null,
        meta: {
          commission_of_ledger_id: Number(p.settlementLedgerId),
          percent: rule.percent,
          // Which cell of the grid charged this, so a disputed
          // commission can be traced back without replaying config
          // history. `gtype` is kept for the pre-2026-09-12 readers.
          market_key: marketKey,
          league_key: leagueKey,
          league_name: leagueName || null,
          rule_source: rule.source || "default",
          gtype: String(bet.gtype || "").toLowerCase() || null,
          net_win: netWin
        },
        commission: comm,
        netamount: -comm,
        profit: null,
        loss: -comm,
        bet_id: bet.id || null,
        closing: newCash,
        category: "SPORTS"
      }, { transaction });
      ledgerId = row.id;
    });
    const pts = await walletService_default.applyCommissionPoints({
      betId: Number(bet.id),
      userId: Number(p.user_id),
      amount: comm,
      remark: description,
      sportId: sportId != null ? String(sportId) : null,
      gtype: marketKey
    });
    if (!pts.success) {
      log2.error("[Commission] points chain failed", { user_id: p.user_id, bet_id: bet.id, error: pts.error });
    }
    log2.info("[Commission] charged", {
      user_id: p.user_id,
      bet_id: bet.id,
      sport_id: sportId,
      market_key: marketKey,
      league_key: leagueKey,
      league: leagueLabel(sportId, leagueKey),
      league_name: leagueName || null,
      rule_source: rule.source || "default",
      market_name: bet.market_type || null,
      net_win: netWin,
      percent: rule.percent,
      commission: comm,
      ledger_id: ledgerId,
      closing_cash: newCash,
      closing_inr: newInr
    });
    return {
      applied: true,
      commission: comm,
      percent: rule.percent,
      ledgerId,
      market_key: marketKey,
      league_key: leagueKey
    };
  } catch (err) {
    log2.error("[Commission] failed \u2014 settlement stands, commission NOT charged", {
      user_id: p?.user_id,
      bet_id: p?.bet?.id,
      error: err.message
    });
    return { applied: false, reason: err.message };
  }
}

export { applyWinCommission };
