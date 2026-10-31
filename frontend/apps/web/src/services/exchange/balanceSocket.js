import { io } from 'socket.io-client';
import { request } from './site';
import { SOCKET_BASE } from './site';
import { announceUserDataChange } from './changeFeed';

/**
 * ─── Sports balance push (mssports socket) ───────────────────────────────────────────────
 *
 * sports-service runs TENEXCH's socket protocol (backend services/sports/src/modules/bets/
 * sockets/socketHandler.mjs), reached through the gateway at `/ws/sports/socket.io` (gateway
 * wsProxy.js strips the `/ws/sports` prefix):
 *
 *   client → 'authenticate' {userId, token}   join room user_<userId> (the room settlement
 *                                               workers push to after a payout)
 *   client → 'subscribeBalance' {token}        server sends balanceUpdate now, then every 30s (safety)
 *   server → 'balanceUpdate' {userId, balance:{inr_balance, exposure}, timestamp}
 *                                               also pushed the moment a money write commits
 *                                               (backend lib/helper/pushBalance.mjs) — announced to
 *                                               changeFeed.js so the match page refetches its book
 *
 * WEBSOCKET ONLY, like TENEXCH: only the UPGRADE is proxied for `/ws/<service>`, the gateway's HTTP
 * routes do not carry `/ws/sports/socket.io` polling requests at all.
 *
 * `userId` is the platform user id: mssports keys its accounts on it (platformAccounts.mjs
 * `decodePlatformToken` → `user_id: Number(sub)`).
 */
export const SPORTS_SOCKET_PATH = '/ws/sports/socket.io';

/**
 * @param {{ token:string, userId:number|string,
 *   onBalance:(b:{ balance:number|null, exposure:number|null, at:string|null }) => void,
 *   onStatus?:(connected:boolean) => void }} p
 * @returns {() => void} disconnect
 */
export function connectBalanceSocket({ token, userId, onBalance, onStatus }) {
  const socket = io(SOCKET_BASE || undefined, {
    path: SPORTS_SOCKET_PATH,
    transports: ['websocket'],
    auth: { token },
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  // Fires on the first connect AND every reconnect, so the room and the 3s feed are re-armed.
  socket.on('connect', () => {
    socket.emit('authenticate', { userId, token });
    socket.emit('subscribeBalance', { token });
    onStatus?.(true);
  });
  socket.on('disconnect', () => onStatus?.(false));
  socket.on('connect_error', () => onStatus?.(false));

  socket.on('balanceUpdate', (data) => {
    if (!data || data.error) return;
    // A push to this socket's room or this socket itself; still compare ids when both are present.
    if (data.userId != null && userId != null && String(data.userId) !== String(userId)) return;
    announceUserDataChange();
    const b = data.balance || {};
    onBalance({
      balance: b.inr_balance != null ? Number(b.inr_balance) : null,
      exposure: b.exposure != null ? Number(b.exposure) : null,
      at: data.timestamp ?? null,
    });
  });

  return () => {
    try { socket.emit('unsubscribeBalance'); } catch { /* already closed */ }
    socket.disconnect();
  };
}

/**
 * REST fallback while the socket is down: the platform wallet's INR row
 * (`GET /api/v1/user/wallet/balances/INR` → {currency, balance:"0.00000000"}).
 * mssports has no REST balance route; its wallet was separate from the platform's on 2026-10-13
 * (README "Sportsbook"), and the backend is being changed to use the platform wallet — until
 * that lands this figure is the PLATFORM balance, and exposure is unknown (null).
 * @returns {Promise<{ balance:number|null, exposure:null, at:null }>}
 */
export async function fetchBalanceRest() {
  const d = await request('/api/v1/user/wallet/balances/INR', { live: true, fixture: null });
  const n = Number(d?.balance);
  return { balance: Number.isFinite(n) ? n : null, exposure: null, at: null };
}
