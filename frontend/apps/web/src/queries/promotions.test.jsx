import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useBonusEvents } from './promotions';

/**
 * `GET /user/bonus/events`, and the shape it does not have.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ROUTE'S NAME IS THE BUG THIS PINS
 *
 * `docs/10`'s Phase 7 bullet reads it as the operator's scheduled
 * promotions, and the promotions page was built on that reading: a "Running
 * now" panel rendering `{name, description, startDate, endDate}`.
 *
 * It is `bonushistory` scoped to the caller — `{id, userId, event, amount,
 * createdAt, updatedAt}`. A log of bonuses already PAID. Not one of the four
 * fields the panel rendered exists on it.
 *
 * The mistake survived review and a live contract check because the table is
 * EMPTY on this deployment: the panel only ever rendered its empty state,
 * which looked exactly right. This test puts a row in, which is the one
 * condition under which the two readings differ.
 * ═════════════════════════════════════════════════════════════════════════
 */

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 1 } }),
}));

const envelope = (data, meta) =>
  new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** A row exactly as `bonus.service.js#shapeEvent` produces one. */
const EVENT_ROW = {
  id: 41,
  userId: 7,
  event: 'weekly',
  amount: '25.00000000',
  createdAt: '2026-09-08T09:15:00.000',
  updatedAt: '2026-09-08T09:15:00.000',
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
  vi.restoreAllMocks();
});

describe('the bonus log', () => {
  it('maps `event` to a name and keeps the amount a string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([EVENT_ROW]));

    const { result } = renderHook(() => useBonusEvents(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [row] = result.current.data.events;
    expect(row).toMatchObject({ id: 41, name: 'weekly', amount: '25.00000000' });
    // `NUMERIC(30,8)` does not survive a float, and nothing here parses it.
    expect(typeof row.amount).toBe('string');
  });

  it('reads the date off `createdAt`, the only date the row has', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([EVENT_ROW]));

    const { result } = renderHook(() => useBonusEvents(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.events[0].at).toBe('2026-09-08T09:15:00.000');
    // The fields the old panel rendered. If any of these ever appears, the
    // platform grew a scheduled-promotions surface and the page should be
    // revisited — but until then, reading them produced `undefined` headings.
    expect(EVENT_ROW.name).toBeUndefined();
    expect(EVENT_ROW.description).toBeUndefined();
    expect(EVENT_ROW.startDate).toBeUndefined();
  });

  it('names an unlabelled row rather than rendering an empty heading', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([{ ...EVENT_ROW, event: '' }]));

    const { result } = renderHook(() => useBonusEvents(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.events[0].name).toBe('Bonus');
  });

  it('carries pagination from `meta`, never from `data`', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      envelope([EVENT_ROW], { pagination: { page: 1, totalPages: 3 } }),
    );

    const { result } = renderHook(() => useBonusEvents(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.pagination.totalPages).toBe(3);
  });

  it('treats an empty log as empty, not as a failure', async () => {
    // Which is every account on this deployment: `bonushistory` has no rows.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([]));

    const { result } = renderHook(() => useBonusEvents(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.events).toEqual([]);
    expect(result.current.isError).toBe(false);
  });
});
