import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useNotificationFeed } from '@/queries/live';
import { useInbox, useMarkInboxRead } from '@/queries/notifications';

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

/**
 * The player's inbox (server rows, server read state) and the public
 * announcement feed (local read set), newest first, with the unread count and
 * the two actions.
 */
export function useNotifications() {
  const { user } = useAuth();
  const readIds = useSyncExternalStore(readStore.subscribe, readStore.get, readStore.get);
  const feed = useNotificationFeed();
  const inbox = useInbox({ enabled: Boolean(user) });
  const markInbox = useMarkInboxRead();

  // Memoised so a not-yet-loaded feed does not hand `markAllRead` a new `[]` every render.
  const rows = useMemo(() => feed.data ?? [], [feed.data]);
  const inboxRows = useMemo(() => inbox.data ?? [], [inbox.data]);
  const inboxUnread = inboxRows.some((row) => !row.read);
  const { mutate } = markInbox;

  /* Keeps the stored ids: dropping them would bring back an announcement that left the
     twenty-row window and returned. */
  const markAllRead = useCallback(() => {
    const seen = new Set(readStore.get());
    for (const row of rows) seen.add(row.id);
    readStore.set([...seen]);
    if (inboxUnread) mutate();
  }, [rows, inboxUnread, mutate]);

  const markRead = useCallback(
    (item) => {
      if (item.read) return;
      if (item.serverId) mutate(item.serverId);
      else readStore.set([...new Set([...readStore.get(), item.id])]);
    },
    [mutate],
  );

  const items = [...inboxRows, ...rows.map((item) => ({ ...item, read: readIds.includes(item.id) }))].sort(
    (a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
  );
  const unread = items.reduce((count, item) => count + (item.read ? 0 : 1), 0);

  /* The page tells loading, failed and empty apart; the bell only needs `unread`. One source
     answering is enough to show a list. */
  const isPending = feed.isPending && (!user || inbox.isPending);
  const isError = feed.isError && (!user || inbox.isError);

  return { items, unread, markAllRead, markRead, isPending, isError };
}
