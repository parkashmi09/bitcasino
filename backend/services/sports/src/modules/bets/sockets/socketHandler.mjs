// socket/socketHandler.js — mssports core, moved unchanged
import { getUserTotalExposure } from "../services/ExposureService.mjs";
import { verifyToken } from "../../../lib/utils/jwt.mjs";
import { walletService_default } from "../../../lib/services/walletService.mjs";

var BALANCE_INTERVAL_MS = 3e3;
var setupSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    socket.on("authenticate", (data) => {
      const { userId, token } = data;
      if (userId) {
        socket.join(`user_${userId}`);
        socket.userId = userId;
      }
    });
    socket.on("getBalance", async (data) => {
      try {
        const token = socket.handshake.auth.token || data?.token;
        if (!token) {
          socket.emit("balanceUpdate", { error: "No token provided" });
          return;
        }
        const decoded = verifyToken(token);
        const userId = decoded.user_id;
        const userRole = (decoded.role || "USER").toUpperCase();
        const balance = await walletService_default.getUserWallet(userId, userRole);
        const total_exposure = await getUserTotalExposure(userId);
        const balanceData = {
          userId,
          balance: {
            inr_balance: balance.inr_balance,
            exposure: total_exposure !== null ? total_exposure : null
            // its total exposure of user of diffrent games combined
          },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        socket.emit("balanceUpdate", balanceData);
      } catch (err) {
        console.error("Error in getBalance socket event:", err);
        socket.emit("balanceUpdate", { error: "Failed to fetch balance", details: err.message });
      }
    });
    socket.on("subscribeBalance", async (data) => {
      try {
        const token = socket.handshake.auth.token || data?.token;
        if (!token) return;
        const decoded = verifyToken(token);
        const userId = decoded.user_id;
        const userRole = (decoded.role || "USER").toUpperCase();
        let inFlight = false;
        const tick = async () => {
          if (inFlight || !socket.connected) return;
          inFlight = true;
          try {
            const balance = await walletService_default.getUserWallet(userId, userRole);
            const total_exposure = await getUserTotalExposure(userId);
            if (!socket.connected) return;
            socket.emit("balanceUpdate", {
              userId,
              balance: {
                ...balance.inr_balance != null && { inr_balance: balance.inr_balance },
                ...total_exposure != null && { exposure: total_exposure }
              },
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
          } catch (err) {
            console.error("Error in balance tick:", err.message);
          } finally {
            inFlight = false;
          }
        };
        if (socket.balanceTimer) clearInterval(socket.balanceTimer);
        await tick();
        socket.balanceTimer = setInterval(tick, BALANCE_INTERVAL_MS);
      } catch (err) {
        console.error("Error in subscribeBalance socket event:", err.message);
      }
    });
    socket.on("unsubscribeBalance", () => {
      if (socket.balanceTimer) {
        clearInterval(socket.balanceTimer);
        socket.balanceTimer = null;
      }
    });
    socket.on("disconnect", () => {
      if (socket.balanceTimer) {
        clearInterval(socket.balanceTimer);
        socket.balanceTimer = null;
      }
    });
  });
  io.engine.on("connection_error", (err) => {
    console.error(
      "Socket.IO connection error:",
      err.code,
      err.message,
      err.context?.sid || ""
    );
  });
};

export { setupSocketHandlers };
