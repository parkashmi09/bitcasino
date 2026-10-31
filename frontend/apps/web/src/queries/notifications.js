import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { subscribe } from '@/lib/socket';
import { queryKeys } from './keys';

/**
 * The player's own inbox (`GET /user/notifications`): deposits approved,
 * bonuses credited, staff broadcasts… Server-side read state, unlike the public
 * announcement feed in `queries/live.js`, whose read set lives in localStorage.
 *
 * Same contract as hash-game-exchange `services/notification.js`: rows
 * `{id, title, body, type, read, createdAt}`; `POST /:id/read` and `/read-all`
 * are the only writes. A new row is pushed to the player's sockets as
 * `notificationsUnread`, so the bell re-reads then instead of only on its poll.
 */

const INBOX_POLL_MS = 60 * 1000;

/** A backend row as the notifications page draws it. The id stays a string (bigint on the wire). */
export const toInboxItem = (row) => ({
  id: `n:${row?.id}`,
  serverId: String(row?.id ?? ''),
  title: String(row?.title ?? ''),
  body: String(row?.body ?? ''),
  at: row?.createdAt ?? null,
  read: Boolean(row?.read),
});

export function useInbox({ enabled = true } = {}) {
  const client = useQueryClient();

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribe('notificationsUnread', () =>
      client.invalidateQueries({ queryKey: queryKeys.account.notifications() }),
    );
  }, [client, enabled]);

  return useQuery({
    queryKey: queryKeys.account.notifications(),
    queryFn: ({ signal }) => api(ENDPOINTS.notifications, { query: { limit: 50 }, signal }),
    select: (rows) => (Array.isArray(rows) ? rows : []).map(toInboxItem),
    enabled,
    staleTime: INBOX_POLL_MS,
    refetchInterval: enabled ? INBOX_POLL_MS : false,
    retry: false,
  });
}

/** `id` = one row's `serverId`; none = every unread row. */
export function useMarkInboxRead() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id) =>
      api(id ? path(ENDPOINTS.notificationRead, { id }) : ENDPOINTS.notificationsReadAll, { method: 'POST' }),
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.account.notifications() }),
  });
}
