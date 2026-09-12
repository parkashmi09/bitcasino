import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, refreshSession } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { tokenStore } from './tokenStore';
import { bindSession } from '@/lib/socket';

/**
 * Session state for the whole app.
 *
 * `status` is the thing to render off, and it has three values rather than a
 * boolean because the difference matters on first paint: after a reload the
 * access token is gone (it never left memory) and only the refresh token
 * survives, so the app genuinely does not know yet whether anyone is signed
 * in. Treating that moment as "signed out" flashes the Login/Sign Up buttons
 * at a player who is signed in, which is the flicker the reference does not
 * have.
 *
 *   loading        — a stored refresh token is being exchanged
 *   authenticated  — `user` is populated
 *   anonymous      — no session, or the stored one is dead
 *
 * `login` and `register` do not catch. The forms need the `ApiError` to place
 * a message under the right field, and swallowing it here would leave them
 * unable to tell "wrong password" from "this account is locked".
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(() =>
    tokenStore.hasSession() ? 'loading' : 'anonymous',
  );

  /**
   * StrictMode mounts effects twice in development. The bootstrap below
   * exchanges a rotating refresh token, and running it twice would present the
   * same token twice — which the backend reads as a captured token and answers
   * by revoking every session the account has.
   *
   * Which is also why there is no `cancelled` flag on the async work. There
   * was one, and it was the reason a reload with a stored session sat on the
   * header's skeleton forever with two 200s in the network panel: StrictMode
   * unmounts, the cleanup sets the flag, the remount short-circuits on this
   * ref — so the only bootstrap in flight belongs to a mount that has already
   * been told to discard its result, and nothing ever moves `status` off
   * `loading`. The guard has to be one or the other, and once the run is
   * once-per-page it cannot also be per-mount.
   *
   * Nothing is leaked by dropping it: this provider lives as long as the app,
   * and a `setState` after unmount has been a silent no-op since React 18.
   */
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    if (!tokenStore.hasSession()) {
      setStatus('anonymous');
      return;
    }

    (async () => {
      // Memory is empty after a reload, so the token has to be minted before
      // `/me` can be asked anything.
      if (!tokenStore.getAccess()) {
        const renewed = await refreshSession();
        if (!renewed) {
          setStatus('anonymous');
          return;
        }
      }

      try {
        const me = await api(ENDPOINTS.me);
        setUser(me);
        setStatus('authenticated');
      } catch {
        // The token verified but the account cannot be read — locked, inactive
        // or deleted. Either way there is no session to show.
        tokenStore.clear();
        setStatus('anonymous');
      }
    })();
  }, []);

  // A refresh that failed mid-session clears the store from inside `api.js`;
  // this is how that becomes a signed-out UI without every caller handling it.
  useEffect(
    () =>
      tokenStore.subscribe(() => {
        if (!tokenStore.hasSession()) {
          setUser(null);
          setStatus('anonymous');
        }
      }),
    [],
  );

  /**
   * Keep the socket's identity in step with the session's.
   *
   * A visitor who signs in without reloading has a socket that was opened with
   * no token, and **every `player` event is refused for the life of that
   * connection** — the deposit address, the withdrawal, the wallet history —
   * until it is rebound. `bindSession` sends `ONLINE_LOGGED`, which also moves
   * the connection out of the previous player's room; on a shared device,
   * skipping that leaves one player receiving the other's private pushes.
   *
   * Keyed on `status` rather than on the token: a rotation does not change who
   * the connection belongs to, and the socket's own `auth` callback re-reads
   * the token on every reconnect. `loading` is skipped because the answer is
   * not known yet and binding to a token that is about to be replaced would
   * announce the session twice.
   */
  useEffect(() => {
    if (status === 'loading') return;
    bindSession();
  }, [status]);

  /** Turn a `{accessToken, refreshToken, user}` payload into a live session. */
  const adopt = useCallback(async (session) => {
    tokenStore.set(session);
    // The session payload carries a summary — id, name, email, status, 2FA —
    // which is enough for the header immediately. `/me` adds level, country,
    // avatar and the referral code, and is not worth blocking the redirect on.
    setUser(session.user);
    setStatus('authenticated');

    try {
      const me = await api(ENDPOINTS.me);
      setUser((current) => ({ ...current, ...me }));
    } catch {
      // The summary stands. A failure here is not a failed sign-in.
    }
    return session.user;
  }, []);

  const login = useCallback(
    async ({ identifier, password, twoFactorCode }) => {
      const session = await api(ENDPOINTS.login, {
        method: 'POST',
        auth: false,
        // `.strict()`: send `twoFactorCode` only when there is one, or an empty
        // string fails the six-digit rule and the answer is a 422 rather than
        // the "code required" the form is waiting for.
        body: {
          identifier: identifier.trim(),
          password,
          ...(twoFactorCode ? { twoFactorCode } : {}),
          deviceLabel: deviceLabel(),
        },
      });
      return adopt(session);
    },
    [adopt],
  );

  const register = useCallback(
    async (fields) => {
      const session = await api(ENDPOINTS.register, {
        method: 'POST',
        auth: false,
        body: fields,
      });
      return adopt(session);
    },
    [adopt],
  );

  const logout = useCallback(async (allSessions = false) => {
    const refreshToken = tokenStore.getRefresh();
    try {
      await api(ENDPOINTS.logout, {
        method: 'POST',
        body: { ...(refreshToken ? { refreshToken } : {}), allSessions },
      });
    } catch (error) {
      // A logout that cannot reach the server still has to sign the player out
      // of this browser — the alternative is a button that appears to do
      // nothing. The server-side session expires on its own.
      if (!(error instanceof ApiError)) throw error;
    } finally {
      tokenStore.clear();
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * What the session list shows beside each device. The full user-agent is
 * recorded server-side from the request; this is the human label.
 */
function deviceLabel() {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const platform =
    /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return platform ? `${browser} on ${platform}` : browser;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
