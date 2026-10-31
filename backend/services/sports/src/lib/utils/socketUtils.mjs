// utils/socketUtils.js — mssports core, moved unchanged
import { redisClient_exports, init_redisClient } from "../config/redisClient.mjs";

var _io = null;
var setIO = (io) => {
  _io = io;
};
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
  const pub2 = await getPublisher();
  if (pub2) {
    try {
      await pub2.publish(BALANCE_UPDATES_CHANNEL, JSON.stringify(payload));
    } catch (err) {
      console.error("emitBalanceUpdate: redis publish failed:", err.message);
    }
  }
};

export { setIO, BALANCE_UPDATES_CHANNEL, emitBalanceUpdate };
