import React from 'react';
import { connectBalanceSocket, fetchBalanceRest } from '../../services/exchange/balanceSocket';
import { getAccessToken } from '../../services/exchange/site';

/* ─── Sports balance + total exposure, pushed ─────────────────────────────────────────────
 *
 * Socket.IO to sports-service through the gateway (`/ws/sports/socket.io`): 'authenticate'
 * {userId, token} + 'subscribeBalance', then a 'balanceUpdate' the moment any money write commits
 * (bet, cancel, void, settlement) and every 30s as a safety read. While the socket is down, the REST
 * fallback is polled every 3s (TENEXCH's header
 * did the same with GET /user/balance; see fetchBalanceRest for what it reads here).
 *
 * @param {{ userId: number|string|null }} p  the platform user id (session `userId`); null = signed out
 * @returns {{ balance:number|null, exposure:number|null, connected:boolean, source:'socket'|'rest'|null }}
 */
const REST_POLL_MS = 3000;
const IDLE = { key: null, balance: null, exposure: null, connected: false, source: null };

export function useSportsBalance({ userId }) {
  const token = getAccessToken();
  const key = userId && token ? `${userId}|${token}` : '';
  const [state, setState] = React.useState(IDLE);

  React.useEffect(() => {
    if (!key) return undefined;
    let active = true;
    let connected = false;
    let restTimer = null;
    const patch = (p) => active && setState((prev) => ({ ...(prev.key === key ? prev : { ...IDLE, key }), ...p, key }));

    const pollRest = async () => {
      if (!active || connected) return;
      /* Hidden tab: no read, just look again later (and at once when it comes back, below). */
      if (document.hidden) {
        restTimer = setTimeout(pollRest, REST_POLL_MS);
        return;
      }
      try {
        const b = await fetchBalanceRest();
        if (!connected) patch({ balance: b.balance, source: 'rest' });
      } catch { /* keep the last figure */ }
      if (active && !connected) restTimer = setTimeout(pollRest, REST_POLL_MS);
    };

    const disconnect = connectBalanceSocket({
      token,
      userId,
      onBalance: (b) => patch({
        ...(b.balance != null ? { balance: b.balance } : null),
        ...(b.exposure != null ? { exposure: b.exposure } : null),
        source: 'socket',
      }),
      onStatus: (up) => {
        connected = up;
        patch({ connected: up });
        clearTimeout(restTimer);
        if (!up) restTimer = setTimeout(pollRest, REST_POLL_MS);
      },
    });
    // Until the socket says hello, the REST figure fills the header.
    restTimer = setTimeout(pollRest, 0);
    const onVisibility = () => {
      if (document.hidden || connected) return;
      clearTimeout(restTimer);
      restTimer = setTimeout(pollRest, 0);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      clearTimeout(restTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      disconnect();
    };
  }, [key, token, userId]);

  const s = state.key === key ? state : IDLE;
  return { balance: s.balance, exposure: s.exposure, connected: s.connected, source: s.source };
}

export default useSportsBalance;
