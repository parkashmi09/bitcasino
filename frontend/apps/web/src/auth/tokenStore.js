/**
 * Where the two tokens live.
 *
 * The access token is **memory only**. It expires in 15 minutes
 * (`JWT_ACCESS_TTL`), so persisting it buys one reload's worth of convenience
 * in exchange for leaving a bearer credential in a store any script on the
 * origin can read.
 *
 * The refresh token lives in the backend's httpOnly cookie (`X-Refresh-Cookie: 1`
 * on every request; backend `auth/refreshCookie.js`), out of reach of page
 * script. It **rotates**: the platform revokes a refresh token the moment it is
 * exchanged and records what replaced it. Presenting a rotated token means two
 * parties hold it, and the backend's answer is to revoke the entire chain —
 * every session, on every device. That is why `api.js` refreshes single-flight.
 *
 * Page script therefore keeps only a non-secret hint (`SESSION_KEY`) that a
 * cookie session may exist, so a reload knows to try a refresh instead of
 * showing a signed-out header. `LEGACY_KEY` holds a refresh token stored before
 * the cookie change: it is sent once on the next refresh, which moves it into
 * the cookie, and then removed.
 */

const SESSION_KEY = 'bc.auth.session';
const LEGACY_KEY = 'bc.auth.refresh';

/** Never written to storage — see above. */
let accessToken = null;
let expiresAt = null;

const listeners = new Set();

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode or blocked storage. The session then lasts until reload,
    // which is degraded but works.
    return null;
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* see read */
  }
}

export const tokenStore = {
  getAccess: () => accessToken,
  /** A pre-cookie refresh token still in storage (sent once, then gone), else null. */
  getRefresh: () => read(LEGACY_KEY),

  /** True once there is something to try — not that it still works. */
  hasSession: () => Boolean(accessToken || read(SESSION_KEY) || read(LEGACY_KEY)),

  /** Store a `{accessToken, expiresAt}` payload from the API; its refresh token is in the cookie. */
  set(session) {
    accessToken = session?.accessToken ?? null;
    expiresAt = session?.expiresAt ? new Date(session.expiresAt) : null;
    write(SESSION_KEY, accessToken ? '1' : null);
    write(LEGACY_KEY, null);
    emit();
  },

  clear() {
    accessToken = null;
    expiresAt = null;
    write(SESSION_KEY, null);
    write(LEGACY_KEY, null);
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
