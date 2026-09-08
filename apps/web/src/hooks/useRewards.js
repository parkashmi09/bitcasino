import { useCallback, useSyncExternalStore } from 'react';
import { CLAIM_CODES, REWARDS } from '@/data/rewards';

/**
 * The reward list, plus the two things a player can change about it: which
 * rewards are enabled, and which extra ones have been claimed with a code.
 *
 * The offers come from `data/rewards.js` and are fixed; those two SETS are the
 * only state, and they live in `localStorage` the way `useNotifications` keeps
 * its read set and `useWallet` keeps the chosen currency. Persistence is what
 * makes `Enable` mean anything — without it the button would flip back on the
 * next reload and the card would be a picture of a control rather than one.
 *
 * It is a **store**, not `useState`, for the reason the other two are: more
 * than one component reads it. The page renders the cards and the claim
 * dialog writes to it, and a hook holding its own state would give each its
 * own copy, so a claimed reward would never appear in the list behind the
 * dialog that claimed it.
 *
 * Storing ids and codes rather than whole reward objects is deliberate — it is
 * also the shape a real `POST /rewards/:id/enable` and `POST /rewards/claim`
 * would leave behind, so when the feed becomes a fetch this file keeps its
 * signature and only `data/rewards.js` and the two actions change.
 *
 * Every storage access is wrapped: private mode and blocked site data both
 * throw on read AND write, and a bonus list is not worth a blank page.
 */

const STORAGE_KEY = 'bc.rewards';

/** `{ enabled: string[], claimed: string[] }`, defensively parsed. */
function read() {
  const empty = { enabled: [], claimed: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return empty;
    const ids = (value) =>
      Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
    return { enabled: ids(parsed.enabled), claimed: ids(parsed.claimed) };
  } catch {
    // Private mode, blocked storage, or a value somebody else wrote. Nothing
    // enabled and nothing claimed is a fine answer.
    return empty;
  }
}

let current = null;
const listeners = new Set();

const store = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /**
   * The snapshot must be referentially stable between writes —
   * `useSyncExternalStore` re-renders on every `Object.is` miss, so building a
   * fresh object here would loop forever. `current` is replaced only in `set`.
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

/** A code as typed to the key `CLAIM_CODES` is written with. */
const normalise = (code) => String(code ?? '').trim().toUpperCase();

/**
 * `items` is every reward the account holds — the standing ones first, then
 * anything claimed, in the order it was claimed — each carrying an `enabled`
 * flag. `enable` turns one on; `claim` redeems a code and reports what
 * happened, which is what the dialog prints.
 */
export function useRewards() {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);

  const enable = useCallback((id) => {
    const { enabled, claimed } = store.get();
    if (enabled.includes(id)) return;
    store.set({ enabled: [...enabled, id], claimed });
  }, []);

  /** `{ ok: true, reward }`, or `{ ok: false, reason }` for the dialog. */
  const claim = useCallback((code) => {
    const key = normalise(code);
    if (key === '') return { ok: false, reason: 'empty' };

    const reward = CLAIM_CODES[key];
    if (!reward) return { ok: false, reason: 'unknown' };

    const { enabled, claimed } = store.get();
    if (claimed.includes(key)) return { ok: false, reason: 'already', reward };

    store.set({ enabled, claimed: [...claimed, key] });
    return { ok: true, reward };
  }, []);

  const claimed = state.claimed
    .map((key) => CLAIM_CODES[key])
    // A code that has left `CLAIM_CODES` since it was stored — an old build's
    // fixture, or a campaign that ended — drops out rather than rendering a
    // blank card.
    .filter(Boolean);

  const items = [...REWARDS, ...claimed].map((reward) => ({
    ...reward,
    enabled: state.enabled.includes(reward.id),
  }));

  return { items, enable, claim };
}
