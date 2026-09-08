import { useCallback, useSyncExternalStore } from 'react';
import { NOTIFICATIONS } from '@/data/notifications';

/**
 * The feed, plus which of it has been read.
 *
 * The rows come from `data/notifications.js` and are fixed; the READ SET is the
 * only state, and it lives in `localStorage` the way `useWallet` keeps the
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
 * Storing read ids rather than a count or a timestamp is deliberate — it is
 * also the shape a real `PATCH /notifications/:id/read` would take, so when the
 * feed becomes a fetch this file keeps its signature and only `NOTIFICATIONS`
 * and `markAllRead` change.
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

  const markAllRead = useCallback(() => {
    readStore.set(NOTIFICATIONS.map((item) => item.id));
  }, []);

  const items = NOTIFICATIONS.map((item) => ({ ...item, read: readIds.includes(item.id) }));
  const unread = items.reduce((count, item) => count + (item.read ? 0 : 1), 0);

  return { items, unread, markAllRead };
}
