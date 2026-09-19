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

/* ---------------------------------------------------------------------------
 * The third wallet preference: which unit a Bitcoin balance reads in.
 *
 * The reference's cashier keeps this under `Currency` in its Wallet settings —
 * `mBTC` (milli-BTC) or `μBTC` (micro-BTC, "bits") — and the site throughout
 * is denominated in whichever is highlighted. Bitcoin's data row defaults to
 * mBTC (`shift: 3`), so this store's default is the same value the code
 * already renders, and picking μBTC restates the row with `shift: 6`.
 *
 * Like the two above: `localStorage`, no platform column, shared across every
 * surface that reads it so flipping it here repaints them together. The seam is
 * the one `docs/11` records for `bc.fiat`.
 * ------------------------------------------------------------------------ */

const BTC_UNIT_KEY = 'bc.btc-unit';

/** The unit choices the cashier's `Bitcoin metric prefix` switch offers. */
export const BTC_UNITS = ['mBTC', 'μBTC'];

function readBtcUnit() {
  try {
    const stored = localStorage.getItem(BTC_UNIT_KEY);
    return stored && BTC_UNITS.includes(stored) ? stored : BTC_UNITS[0];
  } catch {
    // Private mode, or storage disabled. mBTC is what the currency row says.
    return BTC_UNITS[0];
  }
}

let currentBtcUnit = null;
const btcUnitListeners = new Set();

const btcUnitStore = {
  subscribe(listener) {
    btcUnitListeners.add(listener);
    return () => btcUnitListeners.delete(listener);
  },
  get() {
    currentBtcUnit ??= readBtcUnit();
    return currentBtcUnit;
  },
  set(unit) {
    if (!BTC_UNITS.includes(unit) || unit === btcUnitStore.get()) return;
    currentBtcUnit = unit;
    try {
      localStorage.setItem(BTC_UNIT_KEY, unit);
    } catch {
      // The choice still applies to this tab; it just will not outlive it.
    }
    for (const listener of btcUnitListeners) listener();
  },
};

/** `[unit, setUnit]`, shared across every component that calls it. */
export function useBtcUnit() {
  const unit = useSyncExternalStore(btcUnitStore.subscribe, btcUnitStore.get, () => BTC_UNITS[0]);
  return [unit, btcUnitStore.set];
}

/* ---------------------------------------------------------------------------
 * The balances refresh signal.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT `queryClient.invalidateQueries(['balances'])`
 *
 * `useBalances` below is a hand-rolled `useEffect` fetch, not a React Query
 * hook — it predates the query layer and it is a single unparameterised read.
 * So it holds NOTHING in the query cache, and an `invalidateQueries` naming
 * `['balances']` matches no entry and does nothing at all. Silently: an
 * invalidation that hits zero queries is not an error.
 *
 * That was a real defect, found by playing a round in the browser. The Limbo
 * panel repainted with the new balance from the round's own reply while the
 * HEADER CHIP two inches above it still showed the old one, until a
 * navigation happened to remount the hook.
 *
 * A counter every instance subscribes to is what makes one round's settlement
 * reach every mounted `useBalances` at once. `useSyncExternalStore` is
 * already the pattern in this file for exactly that reason.
 * ═════════════════════════════════════════════════════════════════════════
 * ------------------------------------------------------------------------ */

let balancesNonce = 0;
const balancesListeners = new Set();

const balancesSignal = {
  subscribe(listener) {
    balancesListeners.add(listener);
    return () => balancesListeners.delete(listener);
  },
  get: () => balancesNonce,
};

/**
 * Re-read every mounted balance.
 *
 * Called after anything that moves money without going through the query
 * cache: an in-house round settling, a withdrawal, a swap. Cheap — one
 * request per mounted hook, and there are at most two.
 */
export function refreshBalances() {
  balancesNonce += 1;
  for (const listener of balancesListeners) listener();
}

/**
 * `{ balances, status, error, reload }` — `balances` is the currency-keyed map,
 * `{}` until it arrives. `status` is `idle` for a signed-out visitor, so a
 * caller can tell "no wallet" from "an empty one".
 *
 * `reload` refreshes this instance only; `refreshBalances()` above refreshes
 * every one of them.
 */
export function useBalances() {
  const { status: session } = useAuth();
  const [state, setState] = useState({ balances: {}, status: 'idle', error: null });
  const [local, setLocal] = useState(0);
  const shared = useSyncExternalStore(balancesSignal.subscribe, balancesSignal.get, () => 0);
  const nonce = `${local}:${shared}`;

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

  const reload = useCallback(() => setLocal((value) => value + 1), []);

  return { ...state, reload };
}
