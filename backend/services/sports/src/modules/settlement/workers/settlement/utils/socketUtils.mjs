// utils/socketUtils.js — mssports settlement worker, moved unchanged
import { redisClient_exports, init_redisClient } from "../config/redisClient.mjs";

var _io = null;
async function getIO() {
  if (process.env.WORKER_MODE) return null;
  return _io;
}
var BALANCE_UPDATES_CHANNEL = "socket:balance_updates";
var _pub = null;
async function getPublisher() {
  if (_pub) return _pub;
  try {
    const mod = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
    _pub = mod.default;
  } catch {
    _pub = null;
  }
  return _pub;
}
var emitBalanceUpdate = async (userId, balanceData) => {
  const payload = {
    userId,
    balance: {
      ...balanceData.inr_balance != null && { inr_balance: balanceData.inr_balance },
      // Raw exposure value (negative = liability)
      ...balanceData.exposure != null && { exposure: parseFloat(balanceData.exposure) }
    },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const io = await getIO();
  if (io) {
    io.to(`user_${userId}`).emit("balanceUpdate", payload);
    return;
  }
  const pub = await getPublisher();
  if (pub) {
    try {
      await pub.publish(BALANCE_UPDATES_CHANNEL, JSON.stringify(payload));
    } catch (err) {
      console.error("emitBalanceUpdate: redis publish failed:", err.message);
    }
  }
};

export { emitBalanceUpdate };
