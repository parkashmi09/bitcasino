import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The player's settings row — `userconfig` — and the two switches beside it
 * that the platform has no column for.
 *
 * ## The split
 *
 * `GET /user/preferences` answers `{ uid, theme, language, emailNotifications,
 * pushNotifications, hideBalance }`, and `PATCH` takes any subset of the last
 * five. The platform names its own defaults, so a player who has saved nothing
 * still gets a complete row back — this hook never has to invent one.
 *
 * The settings page offers three subscription switches. Lined up:
 *
 *   Email   ✅ `emailNotifications`, read and written
 *   SMS     no column
 *   Call    no column
 *
 * So `Email` is a real `PATCH` and the other two persist in `localStorage`,
 * the way `useProfile` keeps the account form's unsupported fields. Same seam,
 * same rule: when a column lands, the switch moves from `LOCAL_SWITCHES` into
 * the PATCH body and nothing else changes.
 *
 * `pushNotifications`, `theme`, `language` and `hideBalance` are real columns
 * the reference's settings page does not surface — theme and language live in
 * this app's sidebar and footer instead. They are left alone rather than
 * defaulted over: a PATCH that sends only what changed cannot clobber them.
 *
 * Every storage access is wrapped: private mode and blocked site data both
 * throw on read AND write, and two marketing switches are not worth a blank
 * page.
 */

const STORAGE_KEY = 'bc.preferences.local';

/** The switches with no column on the platform, in the reference's order. */
export const LOCAL_SWITCHES = ['sms', 'call'];

/**
 * Both default ON, which is what the platform does with `emailNotifications`
 * — a player who has saved nothing sees three ticked boxes on the reference
 * too, and defaulting these OFF would make the row disagree with the one
 * beside it for no reason a reader could find.
 */
const DEFAULTS = Object.freeze({ sms: true, call: true });

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return DEFAULTS;
    return {
      ...DEFAULTS,
      ...Object.fromEntries(
        LOCAL_SWITCHES.filter((k) => typeof parsed[k] === 'boolean').map((k) => [k, parsed[k]]),
      ),
    };
  } catch {
    return DEFAULTS;
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
 * `{ switches, status, error, toggle, saving, saveError }`.
 *
 * `switches` is `{ email, sms, call }` — one object, so the page does not have
 * to know which of the three is a round trip and which is not. `status` is
 * `idle` for a signed-out visitor.
 */
export function usePreferences() {
  const { status: session } = useAuth();
  const local = useSyncExternalStore(localStore.subscribe, localStore.get, () => DEFAULTS);

  const [state, setState] = useState({ preferences: null, status: 'idle', error: null });
  const [saveState, setSaveState] = useState({ saving: false, saveError: null });

  useEffect(() => {
    if (session !== 'authenticated') {
      setState({ preferences: null, status: 'idle', error: null });
      return undefined;
    }

    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading', error: null }));

    api(ENDPOINTS.preferences, { signal: controller.signal })
      .then((preferences) =>
        setState({ preferences: preferences ?? null, status: 'ready', error: null }),
      )
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({
          preferences: null,
          status: 'error',
          error: error instanceof ApiError ? error : null,
        });
      });

    return () => controller.abort();
  }, [session]);

  /**
   * Flip one switch.
   *
   * The box is repainted before the request goes out and rolled back if it
   * fails, rather than waiting on the round trip: a checkbox that lags its own
   * click by 200ms reads as broken, and the failure has somewhere to be shown.
   *
   * The PATCH carries ONE key. Sending the whole object would write
   * `pushNotifications`, `theme` and `language` back on every tick — values
   * this page never showed the player and has no business restating.
   */
  const toggle = useCallback(
    async (name, next) => {
      if (name !== 'email') {
        localStore.set({ ...localStore.get(), [name]: next });
        return { ok: true, remote: false };
      }

      const previous = state.preferences;
      setState((s) => ({ ...s, preferences: { ...s.preferences, emailNotifications: next } }));
      setSaveState({ saving: true, saveError: null });

      try {
        const preferences = await api(ENDPOINTS.preferences, {
          method: 'PATCH',
          body: { emailNotifications: next },
        });
        setState((s) => ({ ...s, preferences: preferences ?? s.preferences }));
        setSaveState({ saving: false, saveError: null });
        return { ok: true, remote: true };
      } catch (error) {
        setState((s) => ({ ...s, preferences: previous }));
        const apiError = error instanceof ApiError ? error : null;
        setSaveState({ saving: false, saveError: apiError });
        return { ok: false, error: apiError };
      }
    },
    [state.preferences],
  );

  return {
    switches: {
      // `?? true` matches the platform's own default for a row it has not
      // answered yet, so the boxes do not flick from off to on as it lands.
      email: state.preferences?.emailNotifications ?? true,
      sms: local.sms,
      call: local.call,
    },
    status: state.status,
    error: state.error,
    toggle,
    ...saveState,
  };
}

/**
 * `{ rates, status }` — `GET /user/exchange-rate/rates`, a currency-keyed map
 * of `usdRate` strings.
 *
 * PUBLIC, so it is fetched whether or not anybody is signed in: the footer
 * quotes a pair to visitors too. The strings are never parsed into floats for
 * storage — see `fiatPair` in `lib/format.js` — for the reason wallet balances
 * are not: they are decimals, and a float is not.
 */
export function useExchangeRates() {
  const [state, setState] = useState({ rates: {}, status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    api(ENDPOINTS.exchangeRates, { auth: false, signal: controller.signal })
      .then((rows) =>
        setState({
          rates: Object.fromEntries(
            (Array.isArray(rows) ? rows : []).map((row) => [row.currency, row.usdRate]),
          ),
          status: 'ready',
        }),
      )
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        // No rates is a fine answer: the footer falls back to quoting the
        // dollar against itself rather than printing a number we do not have.
        setState({ rates: {}, status: 'error' });
      });

    return () => controller.abort();
  }, []);

  return state;
}
