import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EVENTS } from '@/lib/socket';

/**
 * The live surfaces, and the four things about them that are easy to get
 * wrong.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. THE FEED USES `coin`, LOWERCASE, WHERE THE REST OF THE APP USES
 *    `currency`, UPPERCASE
 *
 * `{name, avatar, game, coin, amount, profit, at}` is the legacy row shape,
 * and `coin` arrives as `inr`. `currencyMeta('inr')` finds nothing, so a
 * component that passed it through would format money against a default
 * precision and label it in lower case. One rename, in one place.
 *
 * 2. `profit` IS SIGNED, AND THE FEED CARRIES LOSSES
 *
 * The server does not filter — `LAST_BETS_BY_GAME` on a game page wants the
 * losses. A "latest wins" strip that forgot to filter would list strangers'
 * losing spins, and the sign has to come off the STRING: these are
 * `NUMERIC(30,8)` decimals and `Number('-0.00000001')` is not what decides
 * whether somebody won.
 *
 * 3. A ROW HAS NO ID, AND NEITHER DOES A NOTIFICATION
 *
 * Bets are keyed on `at` plus position, because two rounds settle in the same
 * millisecond often enough to matter. Notifications get a DERIVED id —
 * `date|title` — because the `notifications` table has no primary key at all,
 * and the read-set in `useNotifications` needs something stable to store.
 *
 * 4. A REFUSAL IS `status !== true`, NOT `!status`
 *
 * The socket's handler refusals set `status` to the error MESSAGE, which is
 * truthy. `request()` in `lib/socket.js` is what normalises that, and these
 * tests go through it rather than around it.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * The socket is mocked at `request`, not at socket.io.
 *
 * What is under test here is the projection — the row shape each hook hands a
 * component — and the envelope handling below it already has its own tests in
 * `lib/socket.test.js`. Mocking the transport instead would test socket.io.
 */
const request = vi.fn();

/**
 * `subscribe` is mocked as a real registry rather than as a spy.
 *
 * The operator-broadcast tests at the bottom need to PUSH a frame and watch
 * what the hook does with it, which a `vi.fn()` returning undefined cannot
 * do. Keeping the handlers lets a test invoke them — and it asserts the
 * contract the real one has: it returns an unsubscribe.
 */
const handlers = new Map();

function push(event, payload) {
  for (const handler of handlers.get(event) ?? []) handler(payload, event);
}

vi.mock('@/lib/socket', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    request: (...args) => request(...args),
    subscribe: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
  };
});

const {
  useLastBets,
  useLastBetsByGame,
  useTopWinners,
  useNotificationFeed,
  useOperatorNotice,
  toBet,
} = await import('./live');

const { LITERAL_EVENTS } = await import('@/lib/socket');

/** A row exactly as `LAST_BETS` answers one. */
const BET_ROW = {
  name: 'demo_player01',
  avatar: null,
  game: 'limbo',
  coin: 'inr',
  amount: '10.00000000',
  profit: '23.30000000',
  at: '2026-09-09T11:02:36.856Z',
};

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  request.mockReset();
  handlers.clear();
});

describe('a bet row, normalised', () => {
  it('upper-cases the coin and renames it to what every formatter wants', () => {
    expect(toBet(BET_ROW, 0).currency).toBe('INR');
  });

  it('reads the win off the sign of the string, not off arithmetic', () => {
    expect(toBet({ ...BET_ROW, profit: '23.30000000' }, 0).won).toBe(true);
    expect(toBet({ ...BET_ROW, profit: '-10.00000000' }, 0).won).toBe(false);
    // A pushed round is not a win, and `-0` is not a thing a decimal string is.
    expect(toBet({ ...BET_ROW, profit: '0' }, 0).won).toBe(false);
  });

  it('never turns money into a number', () => {
    const row = toBet({ ...BET_ROW, amount: '0.00000001' }, 0);
    expect(row.amount).toBe('0.00000001');
    expect(typeof row.amount).toBe('string');
  });

  it('keys on the timestamp AND the position, because two rounds share a millisecond', () => {
    const a = toBet(BET_ROW, 0);
    const b = toBet(BET_ROW, 1);
    expect(a.key).not.toBe(b.key);
  });

  it('survives a row with nothing on it', () => {
    // The feed is public and the client renders it unauthenticated; a null
    // field must produce a dull row, not a thrown render inside the boundary.
    const row = toBet({}, 0);
    expect(row.player).toBe('Anonymous');
    expect(row.game).toBe('Unknown game');
    expect(row.profit).toBe('0');
    expect(row.won).toBe(false);
  });
});

describe('the feeds', () => {
  it('reads `bets` off LAST_BETS', async () => {
    request.mockResolvedValue({ bets: [BET_ROW] });

    const { result } = renderHook(() => useLastBets(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(request).toHaveBeenCalledWith(EVENTS.LAST_BETS);
    expect(result.current.data[0].player).toBe('demo_player01');
  });

  it('reads `winners` off TOP_WINNERS — a different key for the same shape', async () => {
    request.mockResolvedValue({ winners: [BET_ROW] });

    const { result } = renderHook(() => useTopWinners(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
  });

  it('sends the game key with LAST_BETS_BY_GAME', async () => {
    request.mockResolvedValue({ game: 'limbo', bets: [BET_ROW] });

    const { result } = renderHook(() => useLastBetsByGame('limbo'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(request).toHaveBeenCalledWith(EVENTS.LAST_BETS_BY_GAME, { game: 'limbo' });
  });

  it('does not ask at all without a game key', () => {
    // An empty name is the one input the server REFUSES, so it must never be
    // sent — an unknown name would merely answer an empty list.
    renderHook(() => useLastBetsByGame(''), { wrapper: wrapper() });
    expect(request).not.toHaveBeenCalled();
  });

  it('treats a reply with no rows as an empty feed, not as a failure', async () => {
    request.mockResolvedValue({ bets: null });

    const { result } = renderHook(() => useLastBets(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe('the notification feed', () => {
  const NOTICE = {
    title: 'Welcome aboard',
    content: 'Great to see you on the site.',
    date: '2026-09-07T13:19:06.538Z',
  };

  it('derives an id from the date and the title, because the row has none', async () => {
    request.mockResolvedValue({ notifications: [NOTICE] });

    const { result } = renderHook(() => useNotificationFeed(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data[0]).toMatchObject({
      id: '2026-09-07T13:19:06.538Z|Welcome aboard',
      title: 'Welcome aboard',
      body: 'Great to see you on the site.',
    });
  });

  it('maps `content` to `body`, which is what the page renders', async () => {
    request.mockResolvedValue({ notifications: [NOTICE] });

    const { result } = renderHook(() => useNotificationFeed(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data[0].body).toBe(NOTICE.content);
  });

  it('answers an empty list for a deployment with no announcements', async () => {
    request.mockResolvedValue({ notifications: [] });

    const { result } = renderHook(() => useNotificationFeed(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe('the operator broadcast', () => {
  /**
   * `admin_notify` — the only PUSHED surface in this file.
   *
   * The four feeds above are polls: the platform answers them on request and
   * broadcasts nothing on them. This one arrives unasked and cannot be asked
   * for, which is also why it is a transient banner rather than a row in the
   * notification feed — it writes nothing, so it exists for whoever is
   * connected at that moment and nowhere afterwards.
   */
  function listen() {
    const seen = [];
    renderHook(() => useOperatorNotice((notice) => seen.push(notice)), {
      wrapper: wrapper(),
    });
    return seen;
  }

  it('reads the MISSPELLED field, which is what an older build sends alone', async () => {
    /**
     * `mesage`. One `s`. That typo IS the wire protocol.
     *
     * This platform sends the correct spelling alongside it, which makes
     * `message ?? mesage` look like the safe order — it is the wrong one to
     * rely on alone, because an older build sends only the typo and a reader
     * that understood just `message` would go silently quiet against it.
     */
    const seen = listen();
    await act(async () => {
      push(LITERAL_EVENTS.ADMIN_NOTIFY, { mesage: 'Maintenance at 02:00' });
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].text).toBe('Maintenance at 02:00');
  });

  it('reads the correct spelling too, which this platform sends alongside', async () => {
    const seen = listen();
    await act(async () => {
      push(LITERAL_EVENTS.ADMIN_NOTIFY, { mesage: 'Both', message: 'Both' });
    });

    expect(seen[0].text).toBe('Both');
  });

  it('ignores an empty notice rather than flashing a blank banner', async () => {
    const seen = listen();
    await act(async () => {
      push(LITERAL_EVENTS.ADMIN_NOTIFY, { mesage: '   ' });
      push(LITERAL_EVENTS.ADMIN_NOTIFY, {});
    });

    expect(seen).toHaveLength(0);
  });
});
