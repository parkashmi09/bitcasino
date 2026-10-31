/* bitcasino: the exchange's site glue — the one file standing in for hash-game-exchange's
 * services/client.js, tokens.js, realtime.js, apiCrypto.js and sportsStatement.js, so every other
 * file under services|utils|hooks|components|pages/Exchange keeps hash's logic as is.
 *
 * Auth is this app's own: `tokenStore` (access token in memory) and `api.js`'s SINGLE-FLIGHT
 * refresh. Never a refresh of our own — two rotations of one refresh token revoke the session.
 */
import { api, refreshSession as refreshPlatform } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { tokenStore } from '@/auth/tokenStore';

/** Same origin: Vite's proxy (dev) and the host's rewrite (prod) carry `/api`. */
export const API_BASE = '';

/* The sports socket lives on the gateway at `/ws/sports/socket.io`. Same origin in dev (vite.config.js
   proxies `/ws`); a host that cannot carry a websocket upgrade (Vercel rewrites) names the gateway
   in VITE_SPORTS_SOCKET_URL. Without either the match page falls back to its HTTP poll. */
export const SOCKET_BASE = String(import.meta.env.VITE_SPORTS_SOCKET_URL || '').replace(/\/+$/, '');

/* No owner API encryption on this site: plain JSON both ways. */
export const ENC_ACCEPT = null;
export const openSealed = async (body) => body;

export const getAccessToken = () => tokenStore.getAccess();
export const isSignedIn = () => Boolean(tokenStore.getAccess());

/** Resolves truthy when a fresh access token landed (api.js shares one refresh between callers). */
export const refreshSession = () => refreshPlatform();

export const isAccountLockedCode = (code) => code === 'ACCOUNT_LOCKED' || code === 'AUTH_ACCOUNT_LOCKED';

/** The session is over: clearing the store signs the player out everywhere (AuthProvider follows it). */
export function notifyAuthExpired() {
  tokenStore.clear();
}

/** A platform read in hash's `request(path, opts)` shape — the envelope's `data`. */
export const request = (path) => api(path);

/* ─── hash services/sportsStatement.js — only what the exchange's Statement needs ─── */

/** true = came through an agent, false = signed up on the site, null = cannot tell. */
export function isAgentTreePlayer(me) {
  if (!me || typeof me !== 'object') return null;
  if (typeof me.agentTree === 'boolean') return me.agentTree;
  const caps = me.capabilities;
  if (!caps || typeof caps !== 'object') return null;
  return caps.vault === false && caps.swap === false && caps.tips === false;
}

export async function getStatementKind() {
  const me = await api(ENDPOINTS.me);
  const agent = isAgentTreePlayer(me);
  return agent === null ? null : agent ? 'agent' : 'direct';
}
