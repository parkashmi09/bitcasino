// wallet_utility/hierarchyUtility.js — mssports core, moved unchanged
import { User_default } from "../../models/user/User.mjs";
import { Staff_default } from "../../models/admin/Staff.mjs";
import { Wallet_default } from "../../models/admin/Wallet.mjs";
import { Owner_default } from "../../models/admin/Owner.mjs";

var decrementAncestorCashReceived = async (userId, amount, transaction) => {
  try {
    console.log(`[Hierarchy] Decrementing cash_received for ancestors of user ${userId} by ${amount}`);
    const txnOpts = transaction ? { transaction } : {};
    const lockOpts = transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {};
    const user = await User_default.findByPk(userId, txnOpts);
    if (!user) return;
    let currentStaffId = user.parent_staff_id;
    let currentOwnerId = user.parent_owner_id;
    const userWallet = await Wallet_default.findOne({
      where: { user_id: userId, user_type: "USER" },
      ...lockOpts
    });
    if (userWallet) {
      const prevRec = parseFloat(userWallet.cash_received || 0);
      userWallet.cash_received = prevRec - parseFloat(amount);
      await userWallet.save(txnOpts);
      console.log(`[Hierarchy] Decremented cash_received for User ${userId} (${user.username})`);
    }
    while (currentStaffId) {
      const staff = await Staff_default.findByPk(currentStaffId, txnOpts);
      if (!staff) break;
      const wallet = await Wallet_default.findOne({
        where: { staff_id: currentStaffId, user_type: staff.role.toUpperCase() },
        ...lockOpts
      });
      if (wallet) {
        const prevRec = parseFloat(wallet.cash_received || 0);
        wallet.cash_received = prevRec - parseFloat(amount);
        await wallet.save(txnOpts);
        console.log(`[Hierarchy] Decremented cash_received for Staff ${currentStaffId} (${staff.username})`);
      }
      currentOwnerId = staff.parent_owner_id;
      currentStaffId = staff.parent_id;
    }
    if (currentOwnerId) {
      const owner = await Owner_default.findByPk(currentOwnerId, txnOpts);
      if (owner) {
        const wallet = await Wallet_default.findOne({
          where: { owner_id: currentOwnerId, user_type: "OWNER" },
          ...lockOpts
        });
        if (wallet) {
          const prevRec = parseFloat(wallet.cash_received || 0);
          wallet.cash_received = prevRec - parseFloat(amount);
          await wallet.save(txnOpts);
          console.log(`[Hierarchy] Decremented cash_received for Owner ${currentOwnerId} (${owner.username})`);
        }
      }
    }
  } catch (e) {
    console.error("\u274C decrementAncestorCashReceived error:", e);
    throw e;
  }
};

export { decrementAncestorCashReceived };
