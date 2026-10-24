import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useNotificationFeed } from '@/queries/live';

/**
 * The announcement feed, plus which of it has been read.
 *
 * The rows are the platform's — `C.NOTIFICATION`, a public socket event on
 * user-service, read through `queries/live.js`. The READ SET is the only state
 * this file owns, and it lives in `localStorage` the way `useWallet` keeps the
 * chosen currency. That is what makes `Mark all as read` and the bell's unread
 * pip mean something: without persistence the pip would come back on every
 * reload and the button would be decoration.
 *
 * It is a **store**, not `useState`, for the same reason the currency is. Two
 * separate components read this — the bell in the header and the page under it
 * — and a hook holding its own state would give each its own copy, so pressing
 * `Mark all as read` would clear the list and leave the pip lit. Everything
 * subscribes, so one write repaints both on the same frame with no context
 * threaded through the layout.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE READ SET IS KEYED ON A DERIVED ID, BECAUSE THE ROWS HAVE NONE.
 *
 * `notifications` is declared `(title, content, date)` with no primary key
 * and no unique column, so there is nothing on the wire to address one notice
 * by. `queries/live.js` derives `date|title`, and the consequences are stated
 * there rather than discovered here: an edited title comes back unread, and
 * two notices sharing a title and an instant collapse to one.
 *
 * This file previously read `data/notifications.js`, a static array, whose own
 * comment said the platform "has no notification service" and that there was
 * "no feed route in user-service". The first half was right and the second was
 * looking in the wrong place — the feed is a socket event, not a route, and it
 * had been there the whole time. It answered `SOCKET_HANDLER_FAILED` for every
 * caller until Phase 8, which is probably why nobody found it: the fixture was
 * written against an event that could not have worked.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Every storage access is wrapped: private mode and blocked site data both
 * throw on read AND write, and a notification list is not worth a blank page.
 */

const STORAGE_KEY = 'bc.notifications.read';

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    // Private mode, blocked storage, or a value somebody else wrote. Nothing
    // read is a fine answer.
    return [];
  }
}

let current = null;
const listeners = new Set();

const readStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /**
   * The snapshot must be referentially stable between writes —
   * `useSyncExternalStore` re-renders on every `Object.is` miss, so building a
   * fresh array here would loop forever. `current` is replaced only in `set`.
   */
  get() {
    current ??= read();
    return current;
  },
  set(ids) {
    current = ids;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // The change still applies to this tab; it just will not outlive it.
    }
    for (const listener of listeners) listener();
  },
};

/** The feed with a `read` flag on each row, the unread count, and the action. */
export function useNotifications() {
  const readIds = useSyncExternalStore(readStore.subscribe, readStore.get, readStore.get);
  const { data, isPending, isError } = useNotificationFeed();

  /**
   * `useMemo` for a fallback of `[]`, which looks like overkill and is not.
   *
   * React Query hands back the SAME array between renders while the data has
   * not changed, so `data` is stable — but `data ?? []` builds a fresh empty
   * array on every render before the first response lands, and that array is
   * a dependency of the `useCallback` below. Without the memo, `markAllRead`
   * has a new identity on every render of a not-yet-loaded feed, which is
   * exactly the churn that makes a memoised child re-render for no reason.
   */
  const rows = useMemo(() => data ?? [], [data]);

  /**
   * `Mark all as read` marks what is CURRENTLY ON SCREEN, and keeps the ids
   * that were already stored.
   *
   * Dropping the old ones would resurrect a notice that has since fallen off
   * the twenty-row window and then come back — an operator editing an old
   * announcement is enough to do that. The set only grows, which is fine: it
   * is a handful of short strings, and the alternative trades a bounded
   * `localStorage` key for a pip that lights up at random.
   */
  const markAllRead = useCallback(() => {
    const seen = new Set(readStore.get());
    for (const row of rows) seen.add(row.id);
    readStore.set([...seen]);
  }, [rows]);

  const items = rows.map((item) => ({ ...item, read: readIds.includes(item.id) }));
  const unread = items.reduce((count, item) => count + (item.read ? 0 : 1), 0);

  /**
   * `isPending` and `isError` are surfaced because the page has to tell three
   * states apart that all render as an empty list: still loading, the read
   * failed, and an operator has posted nothing. The header's pip needs none of
   * them — `unread` is 0 in all three, which is the correct pip either way.
   */
  return { items, unread, markAllRead, isPending, isError };
}
