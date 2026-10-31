// services/admin/sportsMarketVoidService.js — mssports core, moved unchanged
import { db_default, init_db } from "../../../lib/config/db.mjs";
import { TotalExposure_default, init_TotalExposure } from "../../../models/user/TotalExposure.mjs";
// Wallets → credits: the player's sports balance is the platform wallet, credits.inr.
// import { Wallet_default } from "../../../models/admin/Wallet.mjs";
import { Credits_default } from "../../../models/user/Credits.mjs";
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { UserExposure_default } from "../../../models/user/UserExposure.mjs";
import { exposureIdentity } from "../../../lib/helper/lineMarket.mjs";
import { BADLO_EXPOSURE_GAME_TYPE } from "../../../lib/helper/badloMarket.mjs";
import { CreditsLedger_default } from "../../../models/user/CreditsLedger.mjs";
import { recalcTotalExposure } from "../../../lib/helper/totalExposure.mjs";
import { pushBalance } from "../../../lib/helper/pushBalance.mjs";
import { isPerSelectionMarket, selectionExposureRows, releasableLiability, additiveBucketLiability } from "../../../lib/helper/exposureBucket.mjs";
import { VOID_TYPES } from "../../../models/admin/BetVoidAudit.mjs";
import { newVoidGroupId, recordVoidAudit } from "./voidAuditService.mjs";

init_db();
import { Op as Op11 } from "sequelize";
init_TotalExposure();
var recordVoidRefund = async ({ uid, refundAmount, bet, actor, source = "manual_void", label = "MANUAL VOID" }, t) => {
  if (!(Number(refundAmount) > 0)) return null;
  // OLD (Wallets.cash):
  // const wallet = await Wallet_default.findOne({
  //   where: { user_id: uid },
  //   attributes: ["wallet_id", "cash"],
  //   transaction: t
  // });
  const wallet = await Credits_default.findOne({
    where: { uid },
    attributes: ["uid", "id", "inr"],
    transaction: t
  });
  const marketType = bet?.market_type || null;
  const selection = bet?.selection_name ? ` / ${bet.selection_name}` : "";
  const title = bet?.match_title || bet?.event_name || "match";
  const ledgerRow = await CreditsLedger_default.create({
    user_id: String(uid),
    currency: "INR",
    amount: refundAmount,
    reason: "refund",
    description: `${label} \u2014 ${title} / ${marketType || "-"}${selection}`,
    eventid: bet?.eventid ? String(bet.eventid) : null,
    match_id: bet?.match_id ? String(bet.match_id) : null,
    market_type: marketType,
    bet_id: bet?.id ?? null,
    meta: {
      source,
      voided_by: actor || "owner",
      exposure_released: Number(refundAmount)
    },
    netamount: refundAmount,
    // OLD: closing: wallet ? Number(wallet.cash) : null,
    closing: wallet ? Number(wallet.inr) : null,
    profit: null,
    loss: null,
    category: "SPORTS"
  }, { transaction: t });
  return ledgerRow?.id ?? null;
};
var voidOpenMarket = async ({
  match_id,
  market_type,
  gametype = null,
  selection_name = null,
  voidType = VOID_TYPES.MARKET,
  context = {},
  note = null,
  ledgerSource = "manual_void",
  ledgerLabel = "MANUAL VOID"
}) => {
  if (!match_id || !market_type) {
    throw new Error("Missing required fields: match_id, market_type");
  }
  const t = await db_default.transaction();
  try {
    const whereClause = {
      match_id,
      market_type,
      status: "open"
    };
    if (gametype) {
      whereClause.game_type = gametype;
    }
    if (selection_name) {
      whereClause.selection_name = selection_name;
    }
    const bets = await SportsBet_default.findAll({
      where: whereClause,
      attributes: ["user_id"],
      group: ["user_id"],
      transaction: t
    });
    const userIds = bets.map((b) => b.user_id);
    const marketIsPerSelection = isPerSelectionMarket(market_type);
    const scopedToSelection = Boolean(selection_name) && marketIsPerSelection;
    const { game_type: bucketGameType, team_name: bucketSel } = exposureIdentity({
      marketType: market_type,
      selectionName: selection_name || null
    });
    const voidGroupId = newVoidGroupId();
    const auditCtx = context || {};
    const actorName = auditCtx.actor || null;
    const auditPending = [];
    for (const uid of userIds) {
      // OLD (Wallets.cash + Wallets.inr_balance):
      // const walletBefore = await Wallet_default.findOne({
      //   where: { user_id: uid },
      //   attributes: ["cash", "inr_balance"],
      //   transaction: t
      // });
      const walletBefore = await Credits_default.findOne({
        where: { uid },
        attributes: ["uid", "inr"],
        transaction: t
      });
      const snapBefore = await TotalExposure_default.findOne({
        where: { user_id: uid },
        attributes: ["total_exposure"],
        transaction: t
      });
      let refundAmount = 0;
      let ledgerId = null;
      let exposureRowsDeleted = 0;
      let exposureBefore = null;
      const exposureWhere = {
        user_id: uid,
        match_id,
        game_type: bucketGameType
      };
      let perSelection = scopedToSelection;
      if (scopedToSelection) {
        exposureWhere.team_name = { [Op11.in]: selectionExposureRows(bucketSel) };
      }
      let exposures = await UserExposure_default.findAll({
        where: exposureWhere,
        transaction: t
      });
      if (!exposures.length && exposureWhere.game_type !== market_type) {
        exposureWhere.game_type = market_type;
        delete exposureWhere.team_name;
        perSelection = false;
        exposures = await UserExposure_default.findAll({
          where: exposureWhere,
          transaction: t
        });
        if (exposures.length) {
          console.warn(
            "[voidOpenMarket] released a PRE-MIGRATION line exposure row",
            { uid, match_id, market_type }
          );
        }
      }
      const badloSels = (await SportsBet_default.findAll({
        where: { ...whereClause, user_id: uid, badlo: true },
        attributes: ["selection_name"],
        group: ["selection_name"],
        transaction: t
      })).map((b) => b.selection_name);
      let badloWhere = null;
      let badloExposures = [];
      if (badloSels.length > 0) {
        badloWhere = {
          user_id: uid,
          match_id,
          game_type: BADLO_EXPOSURE_GAME_TYPE,
          team_name: {
            [Op11.in]: badloSels.flatMap((s) => selectionExposureRows(
              exposureIdentity({ marketType: market_type, selectionName: s, badlo: true }).team_name
            ))
          }
        };
        badloExposures = await UserExposure_default.findAll({
          where: badloWhere,
          transaction: t
        });
      }
      if (exposures.length > 0 || badloExposures.length > 0) {
        let minExp;
        if (perSelection) {
          minExp = releasableLiability(exposures, { perSelection: true, sel: bucketSel });
        } else if (marketIsPerSelection) {
          minExp = additiveBucketLiability(exposures);
        } else {
          minExp = releasableLiability(exposures, { perSelection: false });
        }
        minExp += additiveBucketLiability(badloExposures);
        exposureBefore = minExp;
        if (minExp < 0) {
          refundAmount = Math.abs(minExp);
          // OLD (Wallets.cash):
          // await Wallet_default.increment("cash", {
          //   by: refundAmount,
          //   where: { user_id: uid },
          //   transaction: t
          // });
          // NEW (credits.inr): the voided liability goes back to inr.
          await Credits_default.increment("inr", {
            by: refundAmount,
            where: { uid },
            transaction: t
          });
          const repBet = await SportsBet_default.findOne({
            where: { ...whereClause, user_id: uid },
            order: [["id", "ASC"]],
            transaction: t
          });
          ledgerId = await recordVoidRefund({
            uid,
            refundAmount,
            bet: repBet,
            actor: actorName,
            source: ledgerSource,
            label: ledgerLabel
          }, t);
        }
        if (exposures.length > 0) {
          exposureRowsDeleted = await UserExposure_default.destroy({
            where: exposureWhere,
            transaction: t
          });
        }
        if (badloExposures.length > 0) {
          exposureRowsDeleted += await UserExposure_default.destroy({
            where: badloWhere,
            transaction: t
          });
        }
      }
      const userBets = await SportsBet_default.findAll({
        where: { ...whereClause, user_id: uid },
        transaction: t
      });
      auditPending.push({
        uid,
        userBets,
        walletBefore,
        snapBefore,
        refundAmount,
        ledgerId,
        exposureRowsDeleted,
        exposureBefore,
        representativeBetId: userBets.length ? Math.min(...userBets.map((b) => Number(b.id))) : null
      });
    }
    await SportsBet_default.update(
      {
        status: "closed",
        result_status: "refunded",
        match_end_time: /* @__PURE__ */ new Date()
      },
      {
        where: whereClause,
        transaction: t
      }
    );
    const totalsAfter = {};
    for (const uid of userIds) {
      totalsAfter[uid] = await recalcTotalExposure(uid, t);
    }
    let auditedBets = 0;
    for (const a of auditPending) {
      // OLD (Wallets.cash + Wallets.inr_balance):
      // const walletAfter = await Wallet_default.findOne({
      //   where: { user_id: a.uid },
      //   attributes: ["cash", "inr_balance"],
      //   transaction: t
      // });
      const walletAfter = await Credits_default.findOne({
        where: { uid: a.uid },
        attributes: ["uid", "inr"],
        transaction: t
      });
      await recordVoidAudit({
        voidGroupId,
        voidType,
        bets: a.userBets,
        representativeBetId: a.representativeBetId,
        before: {
          status: "open",
          resultStatus: "pending",
          // OLD: cash: a.walletBefore?.cash,
          // OLD: inr: a.walletBefore?.inr_balance,
          cash: a.walletBefore?.inr,
          inr: a.walletBefore?.inr,
          exposure: a.exposureBefore,
          totalExposure: a.snapBefore?.total_exposure
        },
        after: {
          status: "closed",
          resultStatus: "refunded",
          // OLD: cash: walletAfter?.cash,
          // OLD: inr: walletAfter?.inr_balance,
          cash: walletAfter?.inr,
          inr: walletAfter?.inr,
          exposure: a.exposureRowsDeleted > 0 ? 0 : a.exposureBefore,
          totalExposure: totalsAfter[a.uid]
        },
        refundAmount: a.refundAmount,
        exposureRowsDeleted: a.exposureRowsDeleted,
        ledgerId: a.ledgerId,
        context: {
          ...auditCtx,
          note: note || (selection_name ? `session void: ${selection_name}` : `whole ${market_type} market`)
        }
      }, t);
      auditedBets += a.userBets.length;
    }
    await t.commit();
    userIds.forEach((uid) => pushBalance(uid));
    return { userIds, betsVoided: auditedBets, voidGroupId };
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

export { recordVoidRefund, voidOpenMarket };
