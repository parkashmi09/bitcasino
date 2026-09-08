/**
 * Where the two tokens live.
 *
 * The access token is **memory only**. It expires in 15 minutes
 * (`JWT_ACCESS_TTL`), so persisting it buys one reload's worth of convenience
 * in exchange for leaving a bearer credential in a store any script on the
 * origin can read.
 *
 * The refresh token is in `localStorage`, because surviving a reload is the
 * whole point of it, and it **rotates**: the platform revokes a refresh token
 * the moment it is exchanged and records what replaced it. Presenting a
 * rotated token means two parties hold it, and the backend's answer is to
 * revoke the entire chain — every session, on every device. That is why
 * `api.js` refreshes single-flight, and why the write below must land before
 * any other caller can read: two concurrent refreshes would kill the account's
 * sessions rather than renew them.
 */

const STORAGE_KEY = 'bc.auth.refresh';

/** Never written to storage — see above. */
let accessToken = null;
let expiresAt = null;

const listeners = new Set();

function readRefresh() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage. The session then lasts until reload,
    // which is degraded but works.
    return null;
  }
}

function writeRefresh(token) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see readRefresh */
  }
}

export const tokenStore = {
  getAccess: () => accessToken,
  getRefresh: () => readRefresh(),

  /** True once there is something to try — not that it still works. */
  hasSession: () => Boolean(accessToken || readRefresh()),

  /** Store a `{accessToken, refreshToken, expiresAt}` payload from the API. */
  set(session) {
    accessToken = session?.accessToken ?? null;
    expiresAt = session?.expiresAt ? new Date(session.expiresAt) : null;
    writeRefresh(session?.refreshToken ?? null);
    emit();
  },

  clear() {
    accessToken = null;
    expiresAt = null;
    writeRefresh(null);
    emit();
  },

  getExpiry: () => expiresAt,

  /** Notified whenever the pair changes, so `AuthProvider` can follow it. */
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

function emit() {
  for (const listener of listeners) listener();
}
