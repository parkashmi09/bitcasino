import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { queryKeys } from '@/queries/keys';

/**
 * Sign in with Google — user-service `auth` (`/user/auth/google/*`):
 *
 *   1. `startGoogleSignIn` keeps a one-time nonce for this tab and sends the browser to
 *      `/google/start?nonce=…`, which sets a signed state cookie and goes to Google.
 *   2. Google returns to the backend, which redirects to `/login/google?code=…` (or `?error=…`).
 *   3. `GoogleLogin` trades `{ code, nonce }` at `/google/exchange` for the session.
 *
 * The nonce ties the code to the tab that started it: a code lifted from the address bar is
 * useless anywhere else.
 */

const NONCE_KEY = 'bc.auth.googleNonce';

/** 32 random bytes as base64url — the backend wants 22–128 of `[A-Za-z0-9_-]`. */
function newNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function startGoogleSignIn() {
  const nonce = newNonce();
  try {
    sessionStorage.setItem(NONCE_KEY, nonce);
  } catch {
    /* private mode: the exchange will fail and say so */
  }
  // Same relative `/api/v1` base every other call uses (proxied in dev, rewritten on Vercel).
  window.location.assign(`${ENDPOINTS.googleStart}?nonce=${encodeURIComponent(nonce)}`);
}

/** The nonce this tab started with, read once. */
export function takeGoogleNonce() {
  try {
    const nonce = sessionStorage.getItem(NONCE_KEY);
    sessionStorage.removeItem(NONCE_KEY);
    return nonce;
  } catch {
    return null;
  }
}

/** Backend error codes on the return trip, as a player reads them. */
const MESSAGES = {
  AUTH_GOOGLE_NOT_CONFIGURED: 'Sign in with Google is not available yet.',
  AUTH_GOOGLE_DISABLED: 'Sign in with Google is switched off on this site.',
  AUTH_GOOGLE_EMAIL_IN_USE: 'An account with this email already exists. Sign in with your password.',
  AUTH_GOOGLE_TWO_FACTOR_ON: 'This account uses two-factor authentication. Sign in with your password.',
};
export function googleErrorMessage(code, fallback = 'Google sign-in did not complete. Please try again.') {
  return MESSAGES[code] || fallback;
}

/** True while the owner's `google_login` switch is on. A failed status read hides the button. */
export function useGoogleLoginEnabled() {
  const { data } = useQuery({
    queryKey: queryKeys.site.googleLogin(),
    queryFn: ({ signal }) => api(ENDPOINTS.googleStatus, { auth: false, signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return Boolean(data?.enabled);
}
