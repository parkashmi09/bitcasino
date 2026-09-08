import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import {
  DEFAULT_CURRENCY,
  DEFAULT_FIAT,
  CURRENCIES,
  FIAT_DISPLAY_CURRENCIES,
} from '@/data/currencies';

/**
 * The two things every wallet surface needs: which currency the player is
 * looking at, and what they hold.
 *
 * ## The chosen currency
 *
 * It is a preference, not session state — it survives a reload and it is not
 * worth a round trip — so it lives in `localStorage` behind a two-line store
 * rather than in `AuthProvider`. `useSyncExternalStore` is what keeps the
 * header chip and the deposit dialog showing the same coin: both subscribe,
 * so changing it in one repaints the other on the same frame, with no context
 * threaded through the layout.
 *
 * ## The balances
 *
 * `GET /user/wallet/balances` answers a currency-keyed map of decimal STRINGS.
 * They are never parsed — see `formatBalance` — and they are only fetched for a
 * signed-in player, because the route is behind `authenticate()` and asking as
 * a visitor is a guaranteed 401 that would trip the single-flight refresh for
 * nothing.
 */

const STORAGE_KEY = 'bc.currency';

function read() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && stored in CURRENCIES ? stored : DEFAULT_CURRENCY;
  } catch {
    // Private mode, or storage disabled. The default is a fine answer.
    return DEFAULT_CURRENCY;
  }
}

let current = null;
const listeners = new Set();

const currencyStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get() {
    current ??= read();
    return current;
  },
  set(code) {
    if (!(code in CURRENCIES) || code === currencyStore.get()) return;
    current = code;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // The choice still applies to this tab; it just will not outlive it.
    }
    for (const listener of listeners) listener();
  },
};

/** `[code, setCode]`, shared across every component that calls it. */
export function useDisplayCurrency() {
  const code = useSyncExternalStore(currencyStore.subscribe, currencyStore.get, () => DEFAULT_CURRENCY);
  return [code, currencyStore.set];
}

/* ---------------------------------------------------------------------------
 * The second currency preference: which FIAT the site quotes in.
 *
 * A separate store from the one above, not a second field on it, because the
 * two answer different questions and change independently — the wallet the
 * player is spending from, and the currency they want that balance READ OUT
 * in. The settings page sets this one; the footer's `1 USDT = …` pair and any
 * future fiat conversion display read it.
 *
 * It is a preference and not session state, so it lives in `localStorage` for
 * the same reasons `bc.currency` does: it survives a reload and it is not
 * worth a round trip. There is no column for it on the platform —
 * `userconfig` has `theme`, `language` and the notification flags, and
 * nothing else — which is the seam `docs/11` records.
 * ------------------------------------------------------------------------ */

const FIAT_KEY = 'bc.fiat';

const FIAT_CODES = new Set(FIAT_DISPLAY_CURRENCIES.map((entry) => entry.code));

function readFiat() {
  try {
    const stored = localStorage.getItem(FIAT_KEY);
    return stored && FIAT_CODES.has(stored) ? stored : DEFAULT_FIAT;
  } catch {
    // Private mode, or storage disabled. The default is a fine answer.
    return DEFAULT_FIAT;
  }
}

let currentFiat = null;
const fiatListeners = new Set();

const fiatStore = {
  subscribe(listener) {
    fiatListeners.add(listener);
    return () => fiatListeners.delete(listener);
  },
  get() {
    currentFiat ??= readFiat();
    return currentFiat;
  },
  set(code) {
    if (!FIAT_CODES.has(code) || code === fiatStore.get()) return;
    currentFiat = code;
    try {
      localStorage.setItem(FIAT_KEY, code);
    } catch {
      // The choice still applies to this tab; it just will not outlive it.
    }
    for (const listener of fiatListeners) listener();
  },
};

/** `[code, setCode]`, shared across every component that calls it. */
export function useFiatCurrency() {
  const code = useSyncExternalStore(fiatStore.subscribe, fiatStore.get, () => DEFAULT_FIAT);
  return [code, fiatStore.set];
}

/**
 * `{ balances, status, error, reload }` — `balances` is the currency-keyed map,
 * `{}` until it arrives. `status` is `idle` for a signed-out visitor, so a
 * caller can tell "no wallet" from "an empty one".
 */
export function useBalances() {
  const { status: session } = useAuth();
  const [state, setState] = useState({ balances: {}, status: 'idle', error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (session !== 'authenticated') {
      setState({ balances: {}, status: 'idle', error: null });
      return undefined;
    }

    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: 'loading', error: null }));

    api(ENDPOINTS.walletBalances, { signal: controller.signal })
      .then((balances) =>
        setState({ balances: balances ?? {}, status: 'ready', error: null }),
      )
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({
          balances: {},
          status: 'error',
          error: error instanceof ApiError ? error : null,
        });
      });

    return () => controller.abort();
  }, [session, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}
