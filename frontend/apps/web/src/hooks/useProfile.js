import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The player's own record, and the one thing the account form has to get
 * right: which of its fields the platform can actually keep.
 *
 * ## The split
 *
 * `GET /user/profile` answers `{ id, username, email, phone, country, avatar,
 * level, referralCode, referralLink, status, twoFactorEnabled, gamesPlayed,
 * lastLoginAt, joinedAt }`. `PUT /user/profile` is `.strict()` on the backend
 * and takes `username`, `country` and `avatar` — nothing else. An unknown key
 * is a 422, not a silent drop, so the form cannot simply post itself.
 *
 * The reference's form has nine fields. Lined up against the platform:
 *
 *   Date of birth   read-only on the reference too; NOT stored here — local
 *   First name      no column
 *   Last name       no column
 *   Country code    no column (`phone` is one string)
 *   Phone number    READ from `GET`, but not accepted by `PUT`
 *   Line ID         no column
 *   Telegram ID     no column
 *   Address         no column
 *   Country         ✅ read AND written
 *   City            no column
 *
 * So `save` sends `country` to the platform and keeps the rest in
 * `localStorage`, the way `useRewards` keeps enabled offers and `useWallet`
 * keeps the chosen currency. That is a real seam, not a stand-in for one: the
 * local half is keyed by field name, so when a column lands the field moves
 * from `LOCAL_FIELDS` to the PUT body and nothing else changes.
 *
 * The local half never leaves the browser. It is the player's own data in
 * their own storage, which is the honest place for it while the platform has
 * nowhere to put it — better than a form that drops what you type, and better
 * than posting fields the API would reject.
 *
 * ## Email verification
 *
 * The reference shows a "verify your account" notice above the identity card
 * while the address is unconfirmed. Nothing in `backend/` reports that:
 * `GET /profile` has no verified flag, and the email module's routes are OTP
 * issue/verify, not a status read. `emailVerified` below is therefore the one
 * FIXTURE value in this hook, and it is marked as such at its definition.
 *
 * Every storage access is wrapped: private mode and blocked site data both
 * throw on read AND write, and a profile form is not worth a blank page.
 */

const STORAGE_KEY = 'bc.profile.local';

/**
 * The form fields the platform has no column for. Order is the reference's,
 * so a reader can line this up against the form without cross-referencing.
 */
export const LOCAL_FIELDS = [
  'dateOfBirth',
  'firstName',
  'lastName',
  'dialCode',
  'phone',
  'lineId',
  'telegramId',
  'address',
  'city',
];

const EMPTY = Object.freeze(Object.fromEntries(LOCAL_FIELDS.map((f) => [f, ''])));

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    // Only known fields, only strings. A value somebody else wrote — or one
    // left behind by an older build — must not reach an input as an object.
    return {
      ...EMPTY,
      ...Object.fromEntries(
        LOCAL_FIELDS.filter((f) => typeof parsed[f] === 'string').map((f) => [f, parsed[f]]),
      ),
    };
  } catch {
    return EMPTY;
  }
}

let current = null;
const listeners = new Set();

const localStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /**
   * Referentially stable between writes — `useSyncExternalStore` re-renders on
   * every `Object.is` miss, so building a fresh object here would loop.
   */
  get() {
    current ??= read();
    return current;
  },
  set(next) {
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The change still applies to this tab; it just will not outlive it.
    }
    for (const listener of listeners) listener();
  },
};

/**
 * FIXTURE. There is no endpoint behind this — see the note above. `false`
 * because that is the state the reference's own account was in when this page
 * was measured, and it is the state that has a layout to reproduce: a
 * confirmed address simply hides the notice.
 */
const EMAIL_VERIFIED = false;

/**
 * `{ profile, local, status, error, save, saving, saveError, reload }`.
 *
 * `profile` is the platform's record, `null` until it arrives. `local` is the
 * browser-held half, always an object so the form can bind to it on the first
 * render. `status` is `idle` for a signed-out visitor, so a caller can tell
 * "no account" from "an account still loading".
 */
export function useProfile() {
  const { status: session } = useAuth();
  const local = useSyncExternalStore(localStore.subscribe, localStore.get, () => EMPTY);

  const [state, setState] = useState({ profile: null, status: 'idle', error: null });
  const [save_, setSave] = useState({ saving: false, saveError: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (session !== 'authenticated') {
      setState({ profile: null, status: 'idle', error: null });
      return undefined;
    }

    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading', error: null }));

    api(ENDPOINTS.profile, { signal: controller.signal })
      .then((profile) => setState({ profile: profile ?? null, status: 'ready', error: null }))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({
          profile: null,
          status: 'error',
          error: error instanceof ApiError ? error : null,
        });
      });

    return () => controller.abort();
  }, [session, nonce]);

  /**
   * Writes the local half first, then the platform half.
   *
   * That order is deliberate. The local write cannot fail in a way worth
   * reporting, and doing it first means a failed `PUT` still leaves everything
   * the player typed in the fields that the `PUT` was never going to carry —
   * rather than throwing away eight fields because the ninth did not save.
   *
   * The `PUT` is skipped entirely when `country` has not changed: the endpoint
   * rejects an empty body with `Nothing to update`, and "nothing to send" is
   * not a failure to show the player.
   */
  const save = useCallback(
    async (values) => {
      localStore.set({
        ...EMPTY,
        ...Object.fromEntries(LOCAL_FIELDS.map((f) => [f, String(values[f] ?? '')])),
      });

      const country = String(values.country ?? '').trim();
      if (country === (state.profile?.country ?? '')) {
        setSave({ saving: false, saveError: null });
        return { ok: true, remote: false };
      }

      setSave({ saving: true, saveError: null });
      try {
        const profile = await api(ENDPOINTS.profile, { method: 'PUT', body: { country } });
        setState((previous) => ({
          ...previous,
          profile: profile ?? { ...previous.profile, country },
        }));
        setSave({ saving: false, saveError: null });
        return { ok: true, remote: true };
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        setSave({ saving: false, saveError: apiError });
        return { ok: false, error: apiError };
      }
    },
    [state.profile],
  );

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return {
    ...state,
    local,
    emailVerified: EMAIL_VERIFIED,
    save,
    ...save_,
    reload,
  };
}

/**
 * `useKyc` lived here. It is `useKycStatus` in `queries/account.js` now.
 *
 * Phase 6 added `POST /user/kyc/submit`, and the mutation for it invalidates
 * the status read. This hook was a hand-rolled `useEffect` fetch holding
 * nothing in the query cache, so that invalidation would have matched zero
 * queries and done nothing — silently, leaving the identity card advertising
 * "Start verification" for documents already sitting in the review queue.
 *
 * The rest of this file stays as it is. `useProfile` has no mutation beside
 * it reaching into a cache, so there is nothing to fix and a rewrite would be
 * churn — see the note at the top of `queries/account.js`.
 */
