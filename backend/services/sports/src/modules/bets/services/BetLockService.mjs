// services/BetLockService.js — mssports core, moved unchanged
import { User_default } from "../../../models/user/User.mjs";
import { Staff_default } from "../../../models/admin/Staff.mjs";

var isBettingAllowed = async (userId, options = {}) => {
  const tx = options.transaction ? { transaction: options.transaction } : {};
  try {
    const user = await User_default.findByPk(userId, {
      attributes: ["user_id", "bet_locked", "parent_staff_id", "parent_owner_id"],
      ...tx
    });
    if (!user) {
      console.error(`BetLock: User ${userId} not found`);
      return false;
    }
    if (user.bet_locked) {
      console.log(`BetLock: User ${userId} is directly locked.`);
      return false;
    }
    if (user.parent_owner_id) {
      return true;
    }
    let currentStaffId = user.parent_staff_id;
    while (currentStaffId) {
      const staff = await Staff_default.findByPk(currentStaffId, {
        attributes: ["staff_id", "bet_locked", "parent_id", "parent_owner_id"],
        ...tx
      });
      if (!staff) {
        break;
      }
      if (staff.bet_locked) {
        console.log(`BetLock: User ${userId} blocked by Staff ${currentStaffId}`);
        return false;
      }
      if (staff.parent_owner_id) {
        return true;
      }
      currentStaffId = staff.parent_id;
    }
    return true;
  } catch (error) {
    console.error("Error in isBettingAllowed:", error);
    return false;
  }
};
var BetLockService_default = { isBettingAllowed };

export { BetLockService_default };
