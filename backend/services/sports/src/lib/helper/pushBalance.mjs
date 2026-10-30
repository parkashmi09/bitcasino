// helper/pushBalance — TENEXCH helper/pushBalance.js, on this platform's wallet.
//
// Push the player's sports header figures the moment a money write has COMMITTED: the balance is
// credits.inr (getUserWallet 'USER' reads the credits row, not Wallets) and the exposure is the
// stored total (total_exposures). The same two reads as the socket's 30 s safety tick
// (modules/bets/sockets/socketHandler.mjs), so no page waits for that tick. Pages refetch their
// exposure book / open bets on this push (frontend services/exchange/changeFeed.js).
// Fire-and-forget: a failed push never touches the committed write.
import { walletService_default } from "../services/walletService.mjs";
import { getUserTotalExposure } from "../../modules/bets/services/ExposureService.mjs";
import { emitBalanceUpdate } from "../utils/socketUtils.mjs";

var pushBalance = (userId) => Promise.all([
  walletService_default.getUserWallet(userId, "USER"),
  getUserTotalExposure(userId)
]).then(([wallet, exposure]) => emitBalanceUpdate(userId, { inr_balance: wallet?.inr_balance, exposure })).catch((err) => console.error("pushBalance failed:", userId, err.message));

export { pushBalance };
