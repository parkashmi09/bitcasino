// services/walletService.js — mssports core, moved unchanged
import { db_default, init_db } from "../config/db.mjs";
import { User_default } from "../../models/user/User.mjs";
import { Staff_default } from "../../models/admin/Staff.mjs";
import { Wallet_default } from "../../models/admin/Wallet.mjs";
import { Credits_default } from "../../models/user/Credits.mjs";
import { SportsBet_default } from "../../models/user/SportsBet.mjs";
import { Owner_default } from "../../models/admin/Owner.mjs";
import { MESSAGES } from "../constants/messages.mjs";
import { CreditsLedger_default } from "../../models/user/CreditsLedger.mjs";
import { Transaction_default } from "../../models/admin/Transaction.mjs";
import { PointLedger_default } from "../../models/admin/PointLedger.mjs";
import { POINT_EVENT, POINT_CATEGORY, pointEntryRef, LEDGER_CATEGORY_ALIASES } from "../constants/pointLedger.mjs";
import { creditsChain, addPoints, isChildUser } from "./creditsPoints.mjs";
import { QueryTypes } from "sequelize";
import { writeDirectEntry, reverseDirectEntry } from "./directPointLedger.mjs";
import { inrToCurrency } from "../helper/toInr.mjs";
import { emitBalanceUpdate } from "../utils/socketUtils.mjs";
import { withVoidSuffix } from "../helper/voidLabel.mjs";
import { decrementAncestorCashReceived } from "../wallet/hierarchyUtility.mjs";

import { Op as Op7 } from "sequelize";
init_db();
var WalletService = {
  // ---------------------------------------------------------------------------
  // Helper: determine correct ID field
  // ---------------------------------------------------------------------------
  getWalletQueryField(userType) {
    const type = userType ? userType.toUpperCase() : null;
    if (type === "USER") return "user_id";
    if (["SUPERADMIN", "COMPANY", "ADMIN", "SUPERMASTER", "MASTER", "AGENT"].includes(type)) return "staff_id";
    if (type === "OWNER") return "owner_id";
    return "USER TYPE NOT FOUND";
  },
  // -----------------------------------------------------------------------
  // Helper: Get Hierarchy IDs (User, Staff, Owner)
  // -----------------------------------------------------------------------
  getHierarchyIds: async (entityId, userType) => {
    const type = userType ? userType.toUpperCase() : "";
    let userId = null;
    let staffId = null;
    let ownerId = null;
    if (type === "USER") {
      userId = entityId;
      const user = await User_default.findByPk(entityId);
      if (user) {
        staffId = user.parent_staff_id;
        ownerId = user.parent_owner_id;
      }
    } else if (type === "OWNER") {
      ownerId = entityId;
    } else {
      staffId = entityId;
      const staff = await Staff_default.findByPk(entityId);
      if (staff && staff.parent_owner_id) {
        ownerId = staff.parent_owner_id;
      } else {
        const owner = await Owner_default.findOne({ attributes: ["owner_id"] });
        if (owner) ownerId = owner.owner_id;
      }
    }
    return { userId, staffId, ownerId };
  },
  // -----------------------------------------------------------------------
  // CREATE WALLET
  // -----------------------------------------------------------------------
  createWallet: async (entityId, userType, transaction, username, credit = 0, cash = 0) => {
    try {
      const roleMap = {
        company: "COMPANY",
        superadmin: "SUPERADMIN",
        admin: "ADMIN",
        supermaster: "SUPERMASTER",
        master: "MASTER",
        agent: "AGENT",
        owner: "OWNER",
        user: "USER"
      };
      const normalised = roleMap[userType?.toLowerCase()] || userType?.toUpperCase();
      const idField = WalletService.getWalletQueryField(normalised);
      const whereClause = { [idField]: entityId, user_type: normalised };
      const existing = await Wallet_default.findOne({ where: whereClause, transaction });
      if (existing) return existing;
      const walletData = {
        user_type: normalised,
        username,
        inr_balance: 0,
        cash: 0,
        credit: 0
      };
      if (idField === "user_id") walletData.user_id = entityId;
      if (idField === "staff_id") walletData.staff_id = entityId;
      if (idField === "owner_id") walletData.owner_id = entityId;
      return await Wallet_default.create(walletData, { transaction });
    } catch (e) {
      console.error("\u274C createWallet error:", e);
      throw e;
    }
  },
  // -----------------------------------------------------------------------
  // CREDIT BALANCE (INR) - Used in creditBalance controller
  // -----------------------------------------------------------------------
  creditBalance: async (entityId, amount, userType, transaction, initiatedBy, senderType = null) => {
    try {
      const idField = WalletService.getWalletQueryField(userType);
      const wallet = await Wallet_default.findOne({ where: { [idField]: entityId, user_type: userType }, transaction });
      if (!wallet) throw new Error("Wallet not found");
      const prev = parseFloat(wallet.inr_balance);
      wallet.inr_balance = prev + parseFloat(amount);
      await wallet.save({ transaction });
      const { userId: t_userId, staffId: t_staffId, ownerId: t_ownerId } = await WalletService.getHierarchyIds(entityId, userType);
      await Transaction_default.create(
        {
          wallet_id: wallet.wallet_id,
          username: wallet.username,
          user_id: t_userId,
          staff_id: t_staffId,
          owner_id: t_ownerId,
          type: "CREDIT_INR",
          amount: parseFloat(amount),
          previous_balance: prev,
          new_balance: wallet.inr_balance,
          balance: wallet.inr_balance,
          credit: wallet.username,
          debit: initiatedBy,
          initiated_by: initiatedBy
        },
        { transaction }
      );
      emitBalanceUpdate(entityId, { inr_balance: wallet.inr_balance });
      return wallet;
    } catch (e) {
      console.error("\u274C creditBalance error:", e);
      throw e;
    }
  },
  // -----------------------------------------------------------------------
  // DEBIT BALANCE (INR)
  // -----------------------------------------------------------------------
  debitBalance: async (entityId, amount, userType, transaction, initiatedBy) => {
    try {
      const idField = WalletService.getWalletQueryField(userType);
      const wallet = await Wallet_default.findOne({ where: { [idField]: entityId, user_type: userType }, transaction });
      if (!wallet) throw new Error("Wallet not found");
      const current = parseFloat(wallet.inr_balance);
      if (current < parseFloat(amount)) throw new Error("Insufficient balance");
      wallet.inr_balance = current - parseFloat(amount);
      const updatedPL = Math.round((wallet.inr_balance - parseFloat(wallet.cash_received || 0)) * 100) / 100;
      wallet.profit_loss = updatedPL;
      wallet.verdict = updatedPL >= 0 ? "profit" : "loss";
      await wallet.save({ transaction });
      const { userId: t_userId, staffId: t_staffId, ownerId: t_ownerId } = await WalletService.getHierarchyIds(entityId, userType);
      await Transaction_default.create({
        wallet_id: wallet.wallet_id,
        username: wallet.username,
        user_id: t_userId,
        staff_id: t_staffId,
        owner_id: t_ownerId,
        type: "DEBIT_INR",
        amount: parseFloat(amount),
        previous_balance: current,
        new_balance: wallet.inr_balance,
        balance: wallet.inr_balance,
        credit: initiatedBy,
        debit: wallet.username,
        initiated_by: initiatedBy
      }, { transaction });
      emitBalanceUpdate(entityId, { inr_balance: wallet.inr_balance });
      return wallet;
    } catch (e) {
      console.error("\u274C debitBalance error:", e);
      throw e;
    }
  },
  /**
   * Recursively decrements cash_received for all ancestors (Staff & Owners)
   * Triggered when a User loses a bet.
   */
  decrementAncestorCashReceived,
  // -----------------------------------------------------------------------
  // ADD CASH → OWNER gets it for FREE
  // -----------------------------------------------------------------------
  //This is old Api and not recommended to use in tenexch
  addCash: async (receiverId, amount, userType, transaction, initiatedBy, senderId = null, senderType = null) => {
    if (!userType || !receiverId) throw new Error("ReceiverId and UserType required");
    try {
      const receiverField = WalletService.getWalletQueryField(userType);
      const receiverWallet = await Wallet_default.findOne({ where: { [receiverField]: receiverId }, transaction });
      if (!receiverWallet) throw new Error("Receiver wallet not found");
      let performDeduction = false;
      let senderOwner = null;
      if (senderId && senderType) {
        if (senderType.toUpperCase() !== "OWNER") {
          performDeduction = true;
        } else {
          const owner = await Owner_default.findByPk(senderId, { transaction });
          senderOwner = owner;
          if (owner && !owner.unlimited_balance) {
            performDeduction = true;
          }
        }
      }
      if (performDeduction) {
        const senderField = WalletService.getWalletQueryField(senderType);
        const senderWallet = await Wallet_default.findOne({
          where: { [senderField]: senderId, user_type: senderType },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!senderWallet) throw new Error("Sender wallet not found");
        const currentBal = parseFloat(senderWallet.inr_balance ?? 0);
        const currentCash = parseFloat(senderWallet.cash ?? 0);
        const deductAmount = parseFloat(amount);
        if (currentBal < deductAmount) throw new Error("Insufficient INR balance in sender");
        if (currentCash < deductAmount) throw new Error("Insufficient CASH in sender");
        const newBalance = Math.round((currentBal - deductAmount) * 100) / 100;
        const newCash = Math.round((currentCash - deductAmount) * 100) / 100;
        senderWallet.setDataValue("inr_balance", newBalance);
        senderWallet.setDataValue("cash", newCash);
        senderWallet.changed("inr_balance", true);
        senderWallet.changed("cash", true);
        const newProfitLoss = Math.round((newBalance - parseFloat(senderWallet.cash_received || 0)) * 100) / 100;
        senderWallet.setDataValue("profit_loss", newProfitLoss);
        senderWallet.setDataValue("verdict", newProfitLoss >= 0 ? "profit" : "loss");
        senderWallet.changed("profit_loss", true);
        senderWallet.changed("verdict", true);
        await senderWallet.save({ transaction });
        let { userId: s_userId, staffId: s_staffId, ownerId: s_ownerId } = await WalletService.getHierarchyIds(senderId, senderType);
        if (senderType.toUpperCase() === "OWNER" && userType.toUpperCase() !== "USER" && userType.toUpperCase() !== "OWNER") {
          s_staffId = receiverId;
        }
        if (senderType.toUpperCase() === "OWNER" && userType.toUpperCase() === "USER") {
          s_userId = receiverId;
        }
        await Transaction_default.create({
          wallet_id: senderWallet.wallet_id,
          user_id: s_userId,
          staff_id: s_staffId,
          owner_id: s_ownerId,
          username: senderType.toUpperCase() === "OWNER" && senderOwner ? senderOwner.username : senderWallet.username,
          type: "DEBIT_FOR_CASH",
          amount: deductAmount,
          previous_balance: currentBal,
          new_balance: newBalance,
          balance: newBalance,
          credit: receiverWallet.username,
          debit: senderType.toUpperCase() === "OWNER" && senderOwner ? senderOwner.username : senderWallet.username,
          initiated_by: initiatedBy
        }, { transaction });
        emitBalanceUpdate(senderId, { inr_balance: newBalance, cash: newCash });
        console.log(`Cash deducted from ${senderType} (${senderId})`);
      } else if (senderType?.toUpperCase() === "OWNER") {
        console.log(`OWNER (${senderId}) added cash \u2192 FREE (unlimited balance)`);
        let { userId: s_userId, staffId: s_staffId, ownerId: s_ownerId } = await WalletService.getHierarchyIds(senderId, senderType);
        if (senderType.toUpperCase() === "OWNER" && userType.toUpperCase() !== "USER" && userType.toUpperCase() !== "OWNER") {
          s_staffId = receiverId;
        }
        if (senderType.toUpperCase() === "OWNER" && userType.toUpperCase() === "USER") {
          s_userId = receiverId;
        }
        const senderWallet = await Wallet_default.findOne({ where: { [WalletService.getWalletQueryField(senderType)]: senderId } });
        const currentBal = senderWallet ? parseFloat(senderWallet.inr_balance || 0) : 0;
        await Transaction_default.create({
          wallet_id: senderWallet ? senderWallet.wallet_id : null,
          user_id: s_userId,
          staff_id: s_staffId,
          owner_id: s_ownerId,
          username: senderOwner ? senderOwner.username : "OWNER",
          type: "DEBIT_FOR_CASH",
          amount: parseFloat(amount),
          previous_balance: currentBal,
          new_balance: currentBal,
          // Balance unchanged
          balance: currentBal,
          credit: receiverWallet.username,
          debit: senderOwner ? senderOwner.username : "OWNER",
          initiated_by: initiatedBy
        }, { transaction });
      }
      const prevCash = parseFloat(receiverWallet.cash || 0);
      const prevInr = parseFloat(receiverWallet.inr_balance || 0);
      receiverWallet.cash = prevCash + parseFloat(amount);
      receiverWallet.inr_balance = prevInr + parseFloat(amount);
      await receiverWallet.save({ transaction });
      let { userId: r_userId, staffId: r_staffId, ownerId: r_ownerId } = await WalletService.getHierarchyIds(receiverId, userType);
      if (senderType && senderType.toUpperCase() === "OWNER" && userType && userType.toUpperCase() === "USER") {
        r_staffId = null;
        if (!r_ownerId) r_ownerId = senderId;
      }
      await Transaction_default.create({
        wallet_id: receiverWallet.wallet_id,
        user_id: r_userId,
        staff_id: r_staffId,
        owner_id: r_ownerId,
        username: receiverWallet.username,
        type: "ADD_CASH",
        amount: parseFloat(amount),
        previous_balance: prevCash,
        new_balance: receiverWallet.cash,
        balance: receiverWallet.inr_balance,
        credit: receiverWallet.username,
        debit: initiatedBy,
        initiated_by: initiatedBy
      }, { transaction });
      emitBalanceUpdate(receiverId, { cash: receiverWallet.cash, inr_balance: receiverWallet.inr_balance });
      return receiverWallet;
    } catch (e) {
      console.error("\u274C addCash error:", e);
      throw e;
    }
  },
  // This is the new api for deposite
  addDeposit: async (receiverId, amount, userType, transaction, initiatedBy, senderId, senderType, remark = "") => {
    if (!receiverId || !userType) throw new Error("receiverId and userType required");
    if (!senderId || !senderType) throw new Error("sender info not found");
    try {
      const senderRole = senderType.toUpperCase();
      if (senderRole !== "OWNER" && senderRole !== "STAFF") {
        throw new Error("Only owner or staff can deposit");
      }
      const dep = Math.round(parseFloat(amount) * 100) / 100;
      if (isNaN(dep) || dep <= 0) throw new Error("amount must be greater than 0");
      const receiverRole = userType.toUpperCase() === "USER" ? "USER" : "STAFF";
      let receiver, parentStaff, parentOwner;
      if (receiverRole === "USER") {
        receiver = await User_default.findByPk(receiverId, { transaction });
        if (!receiver) throw new Error(`User ${receiverId} not found`);
        parentStaff = receiver.parent_staff_id;
        parentOwner = receiver.parent_owner_id;
      } else {
        receiver = await Staff_default.findByPk(receiverId, { transaction });
        if (!receiver) throw new Error(`Staff ${receiverId} not found`);
        parentStaff = receiver.parent_id;
        parentOwner = receiver.parent_owner_id;
      }
      let isDirect = false;
      if (senderRole === "OWNER") {
        isDirect = !parentStaff && Number(parentOwner) === Number(senderId);
      } else {
        isDirect = Number(parentStaff) === Number(senderId);
      }
      if (!isDirect) {
        throw new Error(`${receiver.username} is not your direct child, deposit not allowed`);
      }
      const receiverWallet = await Wallet_default.findOne({
        where: receiverRole === "USER" ? { user_id: receiverId, user_type: "USER" } : { staff_id: receiverId },
        transaction
      });
      if (!receiverWallet) throw new Error("Receiver wallet not found");
      const senderWallet = await Wallet_default.findOne({
        where: senderRole === "OWNER" ? { owner_id: senderId, user_type: "OWNER" } : { staff_id: senderId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!senderWallet) throw new Error("Sender wallet not found");
      let deduct = true;
      if (senderRole === "OWNER") {
        const owner = await Owner_default.findByPk(senderId, { transaction });
        if (owner && owner.unlimited_balance) deduct = false;
      }
      const senderInrBefore = Math.round(parseFloat(senderWallet.inr_balance || 0) * 100) / 100;
      let senderInrAfter = senderInrBefore;
      if (deduct) {
        if (senderInrBefore < dep) throw new Error(MESSAGES.ADMIN.USERS.DEPOSIT_INSUFFICIENT_CREDIT(senderInrBefore));
        senderInrAfter = Math.round((senderInrBefore - dep) * 100) / 100;
        await Wallet_default.increment({ inr_balance: -dep }, { where: { wallet_id: senderWallet.wallet_id }, transaction });
        await Transaction_default.create({
          wallet_id: senderWallet.wallet_id,
          user_id: null,
          staff_id: senderRole === "STAFF" ? senderId : null,
          owner_id: senderRole === "OWNER" ? senderId : null,
          username: senderWallet.username,
          type: "DEPOSIT",
          amount: dep,
          previous_balance: senderInrBefore,
          new_balance: senderInrAfter,
          balance: senderInrAfter,
          credit: receiverWallet.username,
          debit: senderWallet.username,
          initiated_by: initiatedBy
        }, { transaction });
        emitBalanceUpdate(senderId, { inr_balance: senderInrAfter });
      }
      let recInrBefore = Math.round(parseFloat(receiverWallet.inr_balance || 0) * 100) / 100;
      let recInrAfter = Math.round((recInrBefore + dep) * 100) / 100;
      const inc = { inr_balance: dep, credit: dep, all_point: dep };
      if (receiverRole === "USER") {
        inc.cash = dep;
        recInrBefore = Math.round(parseFloat(receiverWallet.cash || 0) * 100) / 100;
        recInrAfter = Math.round((recInrBefore + dep) * 100) / 100;
      }
      await Wallet_default.increment(inc, { where: { wallet_id: receiverWallet.wallet_id }, transaction });
      const recTxn = await Transaction_default.create({
        wallet_id: receiverWallet.wallet_id,
        user_id: receiverRole === "USER" ? receiverId : null,
        staff_id: receiverRole === "STAFF" ? receiverId : null,
        owner_id: null,
        username: receiverWallet.username,
        type: "DEPOSIT",
        amount: dep,
        previous_balance: recInrBefore,
        new_balance: recInrAfter,
        balance: recInrAfter,
        credit: receiverWallet.username,
        debit: senderWallet.username,
        initiated_by: initiatedBy
      }, { transaction });
      const recAllPointBefore = Math.round(parseFloat(receiverWallet.all_point || 0) * 100) / 100;
      const recAllPointAfter = Math.round((recAllPointBefore + dep) * 100) / 100;
      await PointLedger_default.create({
        entry_ref: pointEntryRef.deposit(recTxn.id),
        event_type: POINT_EVENT.CREDIT,
        wallet_id: receiverWallet.wallet_id,
        username: receiverWallet.username,
        settled_with_wallet_id: senderWallet.wallet_id,
        delta: dep,
        all_point_after: recAllPointAfter,
        closing_inr_balance: Math.round((parseFloat(receiverWallet.inr_balance || 0) + dep) * 100) / 100,
        closing_inr_balance_parent: senderInrAfter,
        source_user_id: receiverRole === "USER" ? receiverId : null,
        remark: `${remark}#${senderWallet.username}/${receiverWallet.username}`
      }, { transaction });
      const recCredit = Math.round((parseFloat(receiverWallet.credit || 0) + dep) * 100) / 100;
      const emitData = { inr_balance: recInrAfter, credit: recCredit };
      if (receiverRole === "USER") emitData.cash = Math.round((parseFloat(receiverWallet.cash || 0) + dep) * 100) / 100;
      emitBalanceUpdate(receiverId, emitData);
      return {
        receiver: receiverWallet.username,
        receiver_type: receiverRole,
        amount: dep,
        receiver_inr_after: recInrAfter,
        sender: senderWallet.username,
        sender_inr_after: senderInrAfter,
        sender_charged: deduct
      };
    } catch (e) {
      console.error("\u274C addDeposit error:", e);
      throw e;
    }
  },
  // This is the new api for withdraw from child
  withdrawFromChild: async (childId, amount, userType, transaction, initiatedBy, actorId, actorType, remark = "") => {
    if (!childId || !userType) throw new Error("childId and userType required");
    if (!actorId || !actorType) throw new Error("actor info not found");
    try {
      const actorRole = actorType.toUpperCase();
      if (actorRole !== "OWNER" && actorRole !== "STAFF") {
        throw new Error("Only owner or staff can withdraw");
      }
      const wd = Math.round(parseFloat(amount) * 100) / 100;
      if (isNaN(wd) || wd <= 0) throw new Error("amount must be greater than 0");
      const childRole = userType.toUpperCase() === "USER" ? "USER" : "STAFF";
      let child, parentStaff, parentOwner;
      if (childRole === "USER") {
        child = await User_default.findByPk(childId, { transaction });
        if (!child) throw new Error(`User ${childId} not found`);
        parentStaff = child.parent_staff_id;
        parentOwner = child.parent_owner_id;
      } else {
        child = await Staff_default.findByPk(childId, { transaction });
        if (!child) throw new Error(`Staff ${childId} not found`);
        parentStaff = child.parent_id;
        parentOwner = child.parent_owner_id;
      }
      let isDirect = false;
      if (actorRole === "OWNER") {
        isDirect = !parentStaff && Number(parentOwner) === Number(actorId);
      } else {
        isDirect = Number(parentStaff) === Number(actorId);
      }
      if (!isDirect) {
        throw new Error(`${child.username} is not your direct child, withdrawal not allowed`);
      }
      const childWallet = await Wallet_default.findOne({
        where: childRole === "USER" ? { user_id: childId, user_type: "USER" } : { staff_id: childId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!childWallet) throw new Error("Child wallet not found");
      const actorWallet = await Wallet_default.findOne({
        where: actorRole === "OWNER" ? { owner_id: actorId, user_type: "OWNER" } : { staff_id: actorId },
        transaction
      });
      if (!actorWallet) throw new Error("Parent wallet not found");
      const mainCol = childRole === "USER" ? "cash" : "inr_balance";
      const childMainBefore = Math.round(parseFloat(childWallet[mainCol] || 0) * 100) / 100;
      const childMainAfter = Math.round((childMainBefore - wd) * 100) / 100;
      if (childMainBefore < wd) {
        throw new Error(MESSAGES.ADMIN.USERS.WITHDRAW_INSUFFICIENT_BALANCE(childMainBefore));
      }
      const dec = { inr_balance: -wd, credit: -wd, all_point: -wd };
      if (childRole === "USER") dec.cash = -wd;
      await Wallet_default.increment(dec, { where: { wallet_id: childWallet.wallet_id }, transaction });
      const childTxn = await Transaction_default.create({
        wallet_id: childWallet.wallet_id,
        user_id: childRole === "USER" ? childId : null,
        staff_id: childRole === "STAFF" ? childId : null,
        owner_id: null,
        username: childWallet.username,
        type: "WITHDRAWAL",
        amount: wd,
        previous_balance: childMainBefore,
        new_balance: childMainAfter,
        balance: childMainAfter,
        credit: actorWallet.username,
        debit: childWallet.username,
        initiated_by: initiatedBy
      }, { transaction });
      const childAllPointBefore = Math.round(parseFloat(childWallet.all_point || 0) * 100) / 100;
      const childAllPointAfter = Math.round((childAllPointBefore - wd) * 100) / 100;
      await PointLedger_default.create({
        entry_ref: pointEntryRef.withdraw(childTxn.id),
        event_type: POINT_EVENT.DEBIT,
        wallet_id: childWallet.wallet_id,
        username: childWallet.username,
        settled_with_wallet_id: actorWallet.wallet_id,
        delta: -wd,
        all_point_after: childAllPointAfter,
        closing_inr_balance: Math.round((parseFloat(childWallet.inr_balance || 0) - wd) * 100) / 100,
        closing_inr_balance_parent: Math.round((parseFloat(actorWallet.inr_balance || 0) + wd) * 100) / 100,
        source_user_id: childRole === "USER" ? childId : null,
        remark: `${remark}#${childWallet.username}/${actorWallet.username}`
      }, { transaction });
      const actorInrBefore = Math.round(parseFloat(actorWallet.inr_balance || 0) * 100) / 100;
      const actorInrAfter = Math.round((actorInrBefore + wd) * 100) / 100;
      await Wallet_default.increment({ inr_balance: wd }, { where: { wallet_id: actorWallet.wallet_id }, transaction });
      await Transaction_default.create({
        wallet_id: actorWallet.wallet_id,
        user_id: null,
        staff_id: actorRole === "STAFF" ? actorId : null,
        owner_id: actorRole === "OWNER" ? actorId : null,
        username: actorWallet.username,
        type: "WITHDRAWAL",
        amount: wd,
        previous_balance: actorInrBefore,
        new_balance: actorInrAfter,
        balance: actorInrAfter,
        credit: actorWallet.username,
        debit: childWallet.username,
        initiated_by: initiatedBy
      }, { transaction });
      const childCredit = Math.round((parseFloat(childWallet.credit || 0) - wd) * 100) / 100;
      const childInr = Math.round((parseFloat(childWallet.inr_balance || 0) - wd) * 100) / 100;
      const childEmit = { inr_balance: childInr, credit: childCredit, all_point: childAllPointAfter };
      if (childRole === "USER") childEmit.cash = Math.round((parseFloat(childWallet.cash || 0) - wd) * 100) / 100;
      emitBalanceUpdate(childId, childEmit);
      emitBalanceUpdate(actorId, { inr_balance: actorInrAfter });
      return {
        child: childWallet.username,
        child_type: childRole,
        amount: wd,
        child_main_after: childMainAfter,
        child_all_point_after: childAllPointAfter,
        parent: actorWallet.username,
        parent_inr_after: actorInrAfter
      };
    } catch (e) {
      console.error("\u274C withdrawFromChild error:", e);
      throw e;
    }
  },
  // -----------------------------------------------------------------------
  // SUBTRACT CASH (user → staff/admin)
  // -----------------------------------------------------------------------
  //This is old Api and not recommended to use in tenexch
  subtractCash: async (senderId, amount, senderType, transaction, initiatedBy, receiverId, receiverType) => {
    try {
      const idField = WalletService.getWalletQueryField(senderType);
      const wallet = await Wallet_default.findOne({ where: { [idField]: senderId }, transaction });
      if (!wallet) throw new Error("Wallet not found");
      const prevCash = parseFloat(wallet.cash || 0);
      if (prevCash < parseFloat(amount)) throw new Error("Insufficient cash");
      const prevInr = parseFloat(wallet.inr_balance || 0);
      wallet.cash = prevCash - parseFloat(amount);
      wallet.inr_balance = prevInr - parseFloat(amount);
      await wallet.save({ transaction });
      let { userId: s_userId, staffId: s_staffId, ownerId: s_ownerId } = await WalletService.getHierarchyIds(senderId, senderType);
      if (receiverType && receiverType.toUpperCase() === "OWNER" && senderType && senderType.toUpperCase() === "USER") {
        s_staffId = null;
        if (!s_ownerId) s_ownerId = receiverId;
      }
      await Transaction_default.create({
        wallet_id: wallet.wallet_id,
        user_id: s_userId,
        staff_id: s_staffId,
        owner_id: s_ownerId,
        username: wallet.username,
        type: "SUBTRACT_CASH",
        amount: parseFloat(amount),
        previous_balance: prevCash,
        new_balance: wallet.cash,
        balance: wallet.inr_balance,
        credit: initiatedBy,
        debit: wallet.username,
        initiated_by: initiatedBy
      }, { transaction });
      emitBalanceUpdate(senderId, { cash: wallet.cash, inr_balance: wallet.inr_balance });
      if (receiverId && receiverType) {
        const receiverField = WalletService.getWalletQueryField(receiverType);
        const receiverWallet = await Wallet_default.findOne({
          where: { [receiverField]: receiverId },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (receiverWallet) {
          const rPrevCash = parseFloat(receiverWallet.cash || 0);
          const rPrevInr = parseFloat(receiverWallet.inr_balance || 0);
          receiverWallet.cash = rPrevCash + parseFloat(amount);
          receiverWallet.inr_balance = rPrevInr + parseFloat(amount);
          await receiverWallet.save({ transaction });
          const { userId: r_userId, staffId: r_staffId, ownerId: r_ownerId } = await WalletService.getHierarchyIds(receiverId, receiverType);
          await Transaction_default.create({
            wallet_id: receiverWallet.wallet_id,
            user_id: r_userId,
            staff_id: r_staffId,
            owner_id: r_ownerId,
            username: receiverWallet.username,
            type: "COLLECT_CASH",
            amount: parseFloat(amount),
            previous_balance: rPrevCash,
            new_balance: receiverWallet.cash,
            balance: receiverWallet.inr_balance,
            credit: receiverWallet.username,
            debit: wallet.username,
            initiated_by: initiatedBy
          }, { transaction });
          emitBalanceUpdate(receiverId, { cash: receiverWallet.cash, inr_balance: receiverWallet.inr_balance });
        }
      }
      return wallet;
    } catch (e) {
      console.error("\u274C subtractCash error:", e);
      throw e;
    }
  },
  updateAllPointHierarchy: async (betId, betType) => {
    if (!betId) return { success: false, error: "betId is required" };
    const category = (betType || "").toString().toUpperCase();
    if (!Object.values(POINT_CATEGORY).includes(category)) {
      return { success: false, error: `invalid betType "${betType}" \u2014 SPORTS chahiye` };
    }
    let gtype = null;
    let betCurrency = "INR";
    const ledgerCategories = LEDGER_CATEGORY_ALIASES[category] || [category];
    let credit = await CreditsLedger_default.findOne({
      where: {
        bet_id: betId,
        category: { [Op7.in]: ledgerCategories },
        [Op7.or]: [{ profit: { [Op7.ne]: null } }, { loss: { [Op7.ne]: null } }]
      },
      order: [["id", "ASC"]]
    });
    if (!credit) return { success: false, error: `credits_ledger entry not found for ${category} bet ${betId}` };
    if (credit?.points_applied) {
      return { success: true, duplicate: true, reason: `bet ${betId} ke points pehle hi lag chuke hain` };
    }
    const net = Math.round((parseFloat(credit.profit || 0) + parseFloat(credit.loss || 0)) * 100) / 100;
    if (net === 0) {
      await credit.update({ points_applied: true });
      return { success: true, skipped: true, reason: `bet ${betId} ka net 0 hai` };
    }
    const outcome = net > 0 ? "won" : "loss";
    const userId = Number(credit.user_id);
    const entryRef = pointEntryRef.bet(category, betId);
    if (category === POINT_CATEGORY.SPORTS) {
      const sportsBet = await SportsBet_default.findByPk(betId, { attributes: ["gtype", "original_currency"] });
      gtype = sportsBet?.gtype || null;
      betCurrency = sportsBet?.original_currency || "INR";
    }
    if (!gtype) gtype = credit?.market_type || credit?.meta?.market_type || null;
    const tx = await db_default.transaction();
    try {
      const user = await User_default.findByPk(userId, { transaction: tx });
      if (user?.is_demo) {
        await credit.update({ points_applied: true }, { transaction: tx });
        await tx.commit();
        return { success: true, skipped: true, reason: `bet ${betId} belongs to demo user ${userId} \u2014 points not rolled up` };
      }
      // Direct user: agent chain nahi — `point_ledger_direct` me sirf uski EK entry, bet ki
      // currency me (credits.all_point nahi chhuta). points_applied set nahi hota; void pe
      // reverseAllPointHierarchy direct user ko alag pehchaan ke ulti entry likhta hai.
      if (!(await isChildUser(db_default, userId, tx))) {
        const direct = await writeDirectEntry(db_default, {
          entryRef,
          eventType: POINT_EVENT.BET_SETTLEMENT,
          category,
          userId,
          currency: credit?.currency || "INR",
          delta: net,
          betId,
          sportId: credit?.sport_id || null,
          gameType: gtype,
          remark: credit?.description
        }, { transaction: tx });
        await tx.commit();
        return { success: true, direct: true, duplicate: !direct.written, status: outcome, point: Math.abs(net), entry_ref: entryRef };
      }
      // Chain: player + upar ke saare staff, sabke `credits` rows (Wallets ki jagah).
      const walletIds = await creditsChain(db_default, userId, tx);
      const updated = await addPoints(db_default, walletIds, net, { transaction: tx });
      const wallets = updated;
      const deltaCurrency = await inrToCurrency(net, betCurrency);
      await PointLedger_default.bulkCreate(
        updated.map((w) => ({
          entry_ref: entryRef,
          event_type: POINT_EVENT.BET_SETTLEMENT,
          category,
          bet_id: betId,
          wallet_id: w.wallet_id,
          username: w.username,
          delta: net,
          delta_currency: deltaCurrency,
          all_point_after: parseFloat(w?.all_point || 0),
          closing_inr_balance: parseFloat(w?.inr_balance || 0),
          sport_id: credit?.sport_id || null,
          game_type: gtype,
          source_user_id: userId,
          remark: credit?.description
        })),
        { transaction: tx }
      );
      await credit.update({ points_applied: true }, { transaction: tx });
      await tx.commit();
      for (const w of updated) {
        const entityId = w.user_id || w.staff_id || w.owner_id;
        if (entityId) {
          emitBalanceUpdate(entityId, { all_point: parseFloat(w.all_point || 0) });
        }
      }
      return {
        success: true,
        status: outcome,
        point: Math.abs(net),
        entry_ref: entryRef,
        wallets_updated: wallets.length,
        usernames: wallets.map((w) => w.username)
      };
    } catch (err) {
      await tx.rollback();
      return { success: false, error: err.message };
    }
  },
  /**
   * updateAllPointHierarchy ka ulta — jab ek settle ho chuki bet ko void kiya
   * jaata hai to us settlement se lage all_point/category points wapas lene
   * hote hain (poori chain me: user → staff → owner).
   *
   * Original `settle:bet:*` PointLedger entry kabhi delete nahi hoti; uske
   * saamne `reverse:bet:*` entries banti hain (POINT_EVENT.REVERSAL) —
   * (wallet_id, entry_ref) unique index dobara reverse hone se rokta hai.
   * PointLedger entry likhna zaroori hai: bina ledger ke all_point change ko
   * integrity cron tampering samajh ke revert kar deta hai.
   *
   * @param {number} betId
   * @param {string} betType POINT_CATEGORY ka koi value
   */
  reverseAllPointHierarchy: async (betId, betType) => {
    if (!betId) return { success: false, error: "betId is required" };
    const category = (betType || "").toString().toUpperCase();
    if (!Object.values(POINT_CATEGORY).includes(category)) {
      return { success: false, error: `invalid betType "${betType}" \u2014 SPORTS chahiye` };
    }
    const credit = await CreditsLedger_default.findOne({
      where: {
        bet_id: betId,
        category: { [Op7.in]: LEDGER_CATEGORY_ALIASES[category] || [category] },
        [Op7.or]: [{ profit: { [Op7.ne]: null } }, { loss: { [Op7.ne]: null } }]
      },
      order: [["id", "ASC"]]
    });
    if (!credit) return { success: true, skipped: true, reason: `credits_ledger entry not found for ${category} bet ${betId}` };
    // Direct user: `point_ledger_direct` ki entry ki ulti entry (agar settlement ki entry likhi thi).
    if (!(await isChildUser(db_default, Number(credit.user_id)))) {
      const direct = await reverseDirectEntry(db_default, {
        originalRef: pointEntryRef.bet(category, betId),
        reversalRef: pointEntryRef.betReversal(category, betId),
        eventType: POINT_EVENT.REVERSAL,
        remark: withVoidSuffix(credit?.description || "")
      });
      return { success: true, direct: true, skipped: !direct.written, entry_ref: pointEntryRef.betReversal(category, betId) };
    }
    if (!credit.points_applied) return { success: true, skipped: true, reason: `bet ${betId} ke points kabhi apply hi nahi hue` };
    const net = Math.round((parseFloat(credit.profit || 0) + parseFloat(credit.loss || 0)) * 100) / 100;
    if (net === 0) return { success: true, skipped: true, reason: `bet ${betId} ka net 0 hai` };
    const delta = -net;
    const userId = Number(credit.user_id);
    const entryRef = pointEntryRef.betReversal(category, betId);
    const tx = await db_default.transaction();
    try {
      // Chain: player + upar ke saare staff, sabke `credits` rows (Wallets ki jagah).
      const walletIds = await creditsChain(db_default, userId, tx);
      const updated = await addPoints(db_default, walletIds, delta, { transaction: tx });
      const wallets = updated;
      await PointLedger_default.bulkCreate(
        updated.map((w) => ({
          entry_ref: entryRef,
          event_type: POINT_EVENT.REVERSAL,
          category,
          bet_id: betId,
          wallet_id: w.wallet_id,
          username: w.username,
          delta,
          all_point_after: parseFloat(w?.all_point || 0),
          closing_inr_balance: parseFloat(w?.inr_balance || 0),
          sport_id: credit?.sport_id || null,
          game_type: credit?.market_type || null,
          source_user_id: userId,
          remark: withVoidSuffix(credit?.description || "")
        })),
        { transaction: tx }
      );
      await tx.commit();
      for (const w of updated) {
        const entityId = w.user_id || w.staff_id || w.owner_id;
        if (entityId) emitBalanceUpdate(entityId, { all_point: parseFloat(w.all_point || 0) });
      }
      return { success: true, point: Math.abs(delta), entry_ref: entryRef, wallets_updated: wallets.length };
    } catch (err) {
      await tx.rollback();
      return { success: false, error: err.message };
    }
  },
  // ── Silent void: settlement ke point rows MITA do ──────────────────────────
  // Admin ke "Create statement entry" switch ka OFF wala raasta. Ulti entry
  // likhne ke bajaye ASLI entry hi hata di jaati hai, taaki statement me aisa
  // lage jaise settlement kabhi hui hi nahi.
  //
  // Har deleted row ke liye teen kaam, usi wallet par:
  //   1. wallet.all_point (+ category pts) me se us row ka delta ghatao
  //   2. us wallet ki BAAD wali rows ke snapshots peeche khisakao —
  //      all_point_after hamesha, aur closing_inr_balance SIRF player ki apni
  //      wallet par (settlement ne upline ka inr_balance chhua hi nahi tha,
  //      sirf points chale the)
  //   3. row delete
  //
  // (2) ke bina statement ka "pts" column poora hi jhooth bol deta: baad ki
  // saari rows jeet wala balance dikhati rehti hain aur aakhri line asli wallet
  // se match nahi karti. Aur (1) ke saath all_point = SUM(point_ledger.delta)
  // barabar bana rehta hai — system tracker ka tier-1 check wahi dekhta hai.
  deletePointEntries: async (entryRef) => {
    if (!entryRef) return { success: false, error: "entryRef is required" };
    const tx = await db_default.transaction();
    try {
      const rows = await PointLedger_default.findAll({
        where: { entry_ref: entryRef },
        order: [["id", "ASC"]],
        transaction: tx,
        lock: tx.LOCK.UPDATE
      });
      // Direct user (`point_ledger_direct`): silent void par bhi entry NAHI mitti — sab history
      // rehni chahiye, isliye ulti entry likhi jaati hai (settle:… → reverse:…).
      const direct = await reverseDirectEntry(db_default, {
        originalRef: entryRef,
        reversalRef: entryRef.startsWith("settle:") ? entryRef.replace(/^settle:/, "reverse:") : `reverse:${entryRef}`,
        eventType: POINT_EVENT.REVERSAL,
        remark: null
      }, { transaction: tx });
      if (!rows.length) {
        await tx.commit();
        if (direct.written) return { success: true, direct: true, reversed: true, entry_ref: entryRef };
        return { success: true, skipped: true, reason: `${entryRef} ki koi entry nahi mili` };
      }
      const touched = [];
      for (const r of rows) {
        const delta = Math.round((parseFloat(r.delta) || 0) * 100) / 100;
        // wallet = credits row (point_ledger.wallet_id = credits.id)
        const [wallet] = await db_default.query(
          "SELECT id, uid AS user_id FROM public.credits WHERE id = :w FOR UPDATE",
          { replacements: { w: r.wallet_id }, type: QueryTypes.SELECT, transaction: tx }
        );
        if (!wallet) throw new Error(`wallet ${r.wallet_id} not found (${entryRef})`);
        const categoryColumn = {
          SPORTS: "sports_pts"
        }[String(r.category || "").toUpperCase()];
        await db_default.query(
          `UPDATE public.credits SET all_point = all_point - :d${categoryColumn ? `, ${categoryColumn} = ${categoryColumn} - :d` : ""} WHERE id = :w`,
          { replacements: { d: delta, w: r.wallet_id }, transaction: tx }
        );
        await db_default.query(
          `UPDATE point_ledger SET all_point_after = all_point_after - :d
            WHERE wallet_id = :w AND id > :id AND all_point_after IS NOT NULL`,
          { replacements: { d: delta, w: r.wallet_id, id: r.id }, transaction: tx }
        );
        if (wallet.user_id != null) {
          await db_default.query(
            `UPDATE point_ledger SET closing_inr_balance = closing_inr_balance - :d
              WHERE wallet_id = :w AND id > :id AND closing_inr_balance IS NOT NULL`,
            { replacements: { d: delta, w: r.wallet_id, id: r.id }, transaction: tx }
          );
        }
        await r.destroy({ transaction: tx });
        touched.push(r.wallet_id);
      }
      await tx.commit();
      for (const walletId of touched) {
        const [w] = await db_default.query(
          "SELECT id AS wallet_id, uid AS user_id, staff_id, all_point FROM public.credits WHERE id = :w",
          { replacements: { w: walletId }, type: QueryTypes.SELECT }
        );
        const entityId = w?.user_id || w?.staff_id || w?.owner_id;
        if (entityId) emitBalanceUpdate(entityId, { all_point: parseFloat(w.all_point || 0) });
      }
      return { success: true, deleted: rows.length, entry_ref: entryRef };
    } catch (err) {
      await tx.rollback();
      return { success: false, error: err.message };
    }
  },
  // ── Sports win commission → points chain ────────────────────────────────
  // Settlement ke baad alag movement: user ne `amount` commission di. Wahi
  // hierarchy walk jo updateAllPointHierarchy karta hai (user → staff chain →
  // owner), delta = -amount har wallet par, event_type COMMISSION, ek row per
  // wallet — isi row se user ke statement me "…- Comm" line dikhti hai aur
  // all_point = SUM(point_ledger) bana rehta hai.
  // Plan: docs/plans/2026-09-09-sports-win-commission.md
  applyCommissionPoints: async ({ betId, userId, amount, remark, sportId, gtype }) => {
    const comm = Math.round((parseFloat(amount) || 0) * 100) / 100;
    if (!betId) return { success: false, error: "betId is required" };
    if (!(comm > 0)) return { success: true, skipped: true, reason: "commission is 0" };
    return WalletService._writeCommissionChain({
      betId,
      userId,
      delta: -comm,
      remark,
      sportId,
      gtype,
      eventType: POINT_EVENT.COMMISSION,
      entryRef: pointEntryRef.commission(POINT_CATEGORY.SPORTS, betId),
      childOnly: true
    });
  },
  // Settlement void ke saath commission bhi wapas — ulti entry, original kabhi delete nahi hoti.
  reverseCommissionPoints: async ({ betId, userId, amount, remark, sportId, gtype }) => {
    const comm = Math.round((parseFloat(amount) || 0) * 100) / 100;
    if (!betId) return { success: false, error: "betId is required" };
    if (!(comm > 0)) return { success: true, skipped: true, reason: "commission is 0" };
    return WalletService._writeCommissionChain({
      betId,
      userId,
      delta: comm,
      remark,
      sportId,
      gtype,
      eventType: POINT_EVENT.REVERSAL,
      entryRef: pointEntryRef.commissionReversal(POINT_CATEGORY.SPORTS, betId),
      // Ulti entry tabhi jab asli commission entry likhi gayi thi (direct user ki nahi likhi jaati).
      onlyIfRef: pointEntryRef.commission(POINT_CATEGORY.SPORTS, betId)
    });
  },
  _writeCommissionChain: async ({ betId, userId, delta, remark, sportId, gtype, eventType, entryRef, childOnly = false, onlyIfRef = null }) => {
    const category = POINT_CATEGORY.SPORTS;
    const tx = await db_default.transaction();
    try {
      const user = await User_default.findByPk(userId, { transaction: tx });
      if (user?.is_demo) {
        await tx.commit();
        return { success: true, skipped: true, reason: `bet ${betId} belongs to demo user ${userId} \u2014 commission points not rolled up` };
      }
      const already = await PointLedger_default.findOne({ where: { entry_ref: entryRef }, attributes: ["id"], transaction: tx });
      if (already) {
        await tx.commit();
        return { success: true, duplicate: true, reason: `${entryRef} already written` };
      }
      if (childOnly && !(await isChildUser(db_default, userId, tx))) {
        await tx.commit();
        return { success: true, skipped: true, reason: `bet ${betId} direct user ki hai — commission points nahi` };
      }
      if (onlyIfRef && !(await PointLedger_default.findOne({ where: { entry_ref: onlyIfRef }, attributes: ["id"], transaction: tx }))) {
        await tx.commit();
        return { success: true, skipped: true, reason: `${onlyIfRef} likhi hi nahi gayi thi — ulti entry nahi` };
      }
      // Chain: player + upar ke saare staff, sabke `credits` rows (Wallets ki jagah).
      const walletIds = await creditsChain(db_default, userId, tx);
      const updated = await addPoints(db_default, walletIds, delta, { transaction: tx });
      const wallets = updated;
      await PointLedger_default.bulkCreate(
        updated.map((w) => ({
          entry_ref: entryRef,
          event_type: eventType,
          category,
          bet_id: betId,
          wallet_id: w.wallet_id,
          username: w.username,
          delta,
          all_point_after: parseFloat(w?.all_point || 0),
          closing_inr_balance: parseFloat(w?.inr_balance || 0),
          sport_id: sportId || null,
          game_type: gtype || null,
          source_user_id: userId,
          remark: String(remark || "").slice(0, 255)
        })),
        { transaction: tx }
      );
      await tx.commit();
      for (const w of updated) {
        const entityId = w.user_id || w.staff_id || w.owner_id;
        if (entityId) emitBalanceUpdate(entityId, { all_point: parseFloat(w.all_point || 0) });
      }
      return { success: true, point: Math.abs(delta), entry_ref: entryRef, wallets_updated: wallets.length };
    } catch (err) {
      await tx.rollback();
      return { success: false, error: err.message };
    }
  },
  settlePointsFromChild: async (userId, username, points, actorId, actorType, initiatedBy, remark) => {
    const actorRole = actorType ? actorType.toUpperCase() : "";
    if (actorRole !== "OWNER" && actorRole !== "STAFF") {
      return { success: false, error: "Only owner or staff can do settlement" };
    }
    if (!userId || !username) return { success: false, error: "userId and username are required" };
    if (!actorId) return { success: false, error: "Settling account id not found" };
    const delta = Math.round(parseFloat(points) * 100) / 100;
    if (isNaN(delta)) return { success: false, error: `Invalid points value "${points}"` };
    if (delta === 0) return { success: false, error: "points cannot be 0" };
    const tx = await db_default.transaction();
    try {
      const actorWhere = actorRole === "OWNER" ? { owner_id: actorId, user_type: "OWNER" } : { staff_id: actorId };
      const actorWallet = await Wallet_default.findOne({ where: actorWhere, transaction: tx, lock: tx.LOCK.UPDATE });
      if (!actorWallet) throw new Error(`Wallet not found for ${actorRole} ${actorId}`);
      const user = await User_default.findByPk(userId, { transaction: tx });
      const staff = await Staff_default.findByPk(userId, { transaction: tx });
      let child = null;
      if (user && user.username === username) {
        child = {
          isUser: true,
          id: user.user_id,
          username: user.username,
          parentStaff: user.parent_staff_id,
          parentOwner: user.parent_owner_id
        };
      } else if (staff && staff.username === username) {
        child = {
          isUser: false,
          id: staff.staff_id,
          username: staff.username,
          parentStaff: staff.parent_id,
          parentOwner: staff.parent_owner_id
        };
      }
      if (!child) throw new Error(`${username} (id ${userId}) not found`);
      let isDirect = false;
      if (actorRole === "OWNER") {
        isDirect = !child.parentStaff && Number(child.parentOwner) === Number(actorId);
      } else {
        isDirect = Number(child.parentStaff) === Number(actorId);
      }
      if (!isDirect) {
        throw new Error(`${child.username} is not your direct child, settlement not allowed`);
      }
      const childWhere = child.isUser ? { user_id: child.id, user_type: "USER" } : { staff_id: child.id };
      const childWallet = await Wallet_default.findOne({
        where: childWhere,
        transaction: tx,
        lock: tx.LOCK.UPDATE
      });
      if (!childWallet) throw new Error(`Wallet not found for ${child.username}`);
      if (childWallet.wallet_id === actorWallet.wallet_id) {
        throw new Error("Cannot settle with your own account");
      }
      const sumRow = await PointLedger_default.findOne({
        where: { wallet_id: childWallet.wallet_id },
        attributes: [[db_default.fn("SUM", db_default.col("delta")), "total"]],
        raw: true,
        transaction: tx
      });
      const ledgerPoint = Math.round(parseFloat(sumRow.total || 0) * 100) / 100;
      const counter = Math.round(parseFloat(childWallet.all_point || 0) * 100) / 100;
      const credit = Math.round(parseFloat(childWallet.credit || 0) * 100) / 100;
      const pending = Math.round((ledgerPoint - credit) * 100) / 100;
      if (counter !== ledgerPoint) {
        throw new Error(`${child.username} all_point does not match ledger (wallet ${counter}, ledger ${ledgerPoint}), settlement blocked`);
      }
      if (pending === 0) throw new Error(`${child.username} has no pending settlement`);
      if (pending > 0 && delta > 0 || pending < 0 && delta < 0 || Math.abs(delta) > Math.abs(pending)) {
        throw new Error(`Amount Greater than P/L`);
      }
      const newAllPoint = Math.round((counter + delta) * 100) / 100;
      const taking = delta < 0;
      const childMainCol = child.isUser ? "cash" : "inr_balance";
      const childMainBefore = Math.round(parseFloat(childWallet[childMainCol] || 0) * 100) / 100;
      const childMainAfter = Math.round((childMainBefore + delta) * 100) / 100;
      const actorInrBefore = Math.round(parseFloat(actorWallet.inr_balance || 0) * 100) / 100;
      if (taking && childMainBefore < Math.abs(delta)) {
        throw new Error(`${child.username} has only ${childMainBefore} ${child.isUser ? "cash" : "INR"}, cannot take ${Math.abs(delta)}`);
      }
      if (!taking && actorInrBefore < delta) {
        throw new Error(`${actorWallet.username} has only ${actorInrBefore} INR, cannot pay ${delta}`);
      }
      const actorInrAfter = Math.round((actorInrBefore - delta) * 100) / 100;
      const creditName = taking ? actorWallet.username : child.username;
      const debitName = taking ? child.username : actorWallet.username;
      const txnRow = await Transaction_default.create({
        wallet_id: childWallet.wallet_id,
        user_id: child.isUser ? child.id : null,
        staff_id: child.isUser ? null : child.id,
        owner_id: null,
        username: child.username,
        type: "POINT_SETTLEMENT",
        amount: Math.abs(delta),
        previous_balance: childMainBefore,
        new_balance: childMainAfter,
        balance: childMainAfter,
        credit: creditName,
        debit: debitName,
        initiated_by: initiatedBy || actorWallet.username
      }, { transaction: tx });
      await Transaction_default.create({
        wallet_id: actorWallet.wallet_id,
        user_id: null,
        staff_id: actorRole === "STAFF" ? actorId : null,
        owner_id: actorRole === "OWNER" ? actorId : null,
        username: actorWallet.username,
        type: "POINT_SETTLEMENT",
        amount: Math.abs(delta),
        previous_balance: actorInrBefore,
        new_balance: actorInrAfter,
        balance: actorInrAfter,
        credit: creditName,
        debit: debitName,
        initiated_by: initiatedBy || actorWallet.username
      }, { transaction: tx });
      const entryRef = pointEntryRef.cashSettle(txnRow.id);
      const childInc = { all_point: delta, upper_point: delta, inr_balance: delta };
      if (child.isUser) childInc.cash = delta;
      await Wallet_default.increment(childInc, { where: { wallet_id: childWallet.wallet_id }, transaction: tx });
      await Wallet_default.increment(
        { down_point: -delta, inr_balance: -delta },
        { where: { wallet_id: actorWallet.wallet_id }, transaction: tx }
      );
      remark = remark ? remark : delta > 0 ? POINT_EVENT.BANK_DEPOSIT : POINT_EVENT.BANK_WITHDRAW;
      await PointLedger_default.create({
        entry_ref: entryRef,
        event_type: delta > 0 ? POINT_EVENT.BANK_DEPOSIT : POINT_EVENT.BANK_WITHDRAW,
        wallet_id: childWallet.wallet_id,
        username: child.username,
        settled_with_wallet_id: actorWallet.wallet_id,
        delta,
        all_point_after: newAllPoint,
        closing_inr_balance: Math.round((parseFloat(childWallet.inr_balance || 0) + delta) * 100) / 100,
        closing_inr_balance_parent: actorInrAfter,
        source_user_id: child.isUser ? child.id : null,
        remark: `${remark}#${taking ? `${child.username}/${actorWallet.username}` : `${actorWallet.username}/${child.username}`}`
      }, { transaction: tx });
      await tx.commit();
      emitBalanceUpdate(child.id, { all_point: newAllPoint });
      const pendingAfter = Math.round((pending + delta) * 100) / 100;
      return {
        success: true,
        all_point_after: newAllPoint
      };
    } catch (err) {
      await tx.rollback();
      console.error("\u274C settlePointsFromChild error:", err.message);
      return { success: false, error: err.message };
    }
  },
  // -----------------------------------------------------------------------
  // ADD CREDIT → OWNER gets it for FREE
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // GET USER WALLET
  // -----------------------------------------------------------------------
  getUserWallet: async (entityId, userType) => {
    // NEW (credits.inr): a player's sports balance is the platform wallet. Staff and owner
    // still read Wallets below until their wallets move into credits.
    if (String(userType || "").toUpperCase() === "USER") {
      const c = await Credits_default.findOne({ where: { uid: entityId }, attributes: ["uid", "inr"], raw: true });
      if (!c) throw new Error("Wallet not found");
      const inr = parseFloat(c.inr || 0);
      return { username: null, user_type: "USER", cash: inr, inr_balance: inr, cash_received: 0 };
    }
    const idField = WalletService.getWalletQueryField(userType);
    const w = await Wallet_default.findOne({ where: { [idField]: entityId, user_type: userType } });
    if (!w) throw new Error("Wallet not found");
    return {
      username: w.username,
      user_type: w.user_type,
      cash: parseFloat(w.cash || 0),
      inr_balance: parseFloat(w.inr_balance || 0),
      cash_received: parseFloat(w.cash_received || 0)
    };
  },
  // -----------------------------------------------------------------------
  // Optional: Get all wallets, by role, etc.
  // -----------------------------------------------------------------------
  getAllWallets: async () => await Wallet_default.findAll(),
  getWalletsByRole: async (role) => await Wallet_default.findAll({ where: { user_type: role.toUpperCase() } })
};
var walletService_default = WalletService;

export { walletService_default };
