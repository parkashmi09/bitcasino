import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { makeGates } from '@/lib/gates';
import { promotionOn, raceOn, toPromotionCard, toSlides, toTournament, useBonusEvents } from './promotions';

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

describe('the race, promotion and slide adapters', () => {
  it('treats only an explicit admin switch-off as a race being off', () => {
    expect(raceOn({ type: 'daily' })).toBe(true);
    expect(raceOn({ type: 'weekly', enabled: false })).toBe(false);
    expect(raceOn({ type: 'daily', configured: false })).toBe(false);
  });

  it('draws an open board in its payout currency and links it to its board', () => {
    const card = toTournament({
      type: 'daily',
      endsAt: '2026-10-25T18:30:00.000Z',
      prizePool: '10',
      currency: 'USDT',
      payoutPrizePool: '1234.5',
      payoutCurrency: 'INR',
      leaderboard: [{ rank: 1, name: 'Rahul_99' }],
    });
    expect(card).toMatchObject({
      status: 'active',
      prizePool: '1,234.50 INR',
      leader: 'Rahul_99',
      href: '/promotions/league-of-bitcasino?race=daily',
    });
  });

  it('draws a settled race from its podium, with no link', () => {
    const card = toTournament(
      { raceId: 9, type: 'weekly', prizePool: '50', currency: 'INR', winners: [{ name: 'a' }] },
      { finished: true },
    );
    expect(card).toMatchObject({ slug: 'race-9', status: 'finished', prizePool: '50.00 INR', leader: 'a', href: null });
  });

  it('marks a promotion past by its status or its end date', () => {
    const row = { segment: 'casino', slug: 'x', title: 'X', summary: 's', imageUrl: '/i', promoStatus: 'live' };
    expect(toPromotionCard(row).href).toBe('/promotions/casino/x');
    expect(toPromotionCard(row).ended).toBe(false);
    expect(toPromotionCard({ ...row, promoStatus: 'ended' }).ended).toBe(true);
    expect(toPromotionCard({ ...row, endsAt: '2000-01-01T00:00:00Z' }).ended).toBe(true);
  });

  it('hides sports promotions until the site config says there is a sportsbook', () => {
    const sports = toPromotionCard({ segment: 'sports', slug: 'x' });
    const casino = toPromotionCard({ segment: 'casino', slug: 'x' });
    const off = makeGates({ flags: { sportsbook: false } });
    expect(promotionOn(casino, off)).toBe(true);
    expect(promotionOn(sports, off)).toBe(false);
    expect(promotionOn(sports, makeGates({ flags: null, ready: false }))).toBe(false);
    expect(promotionOn(sports, makeGates({ flags: { sportsbook: true } }))).toBe(true);
  });

  it('keeps active slider placements only, in sortOrder', () => {
    const slides = toSlides([
      { type: 'slider-2', sortOrder: 2, url: '/b', title: 'B', cta: { href: '/sports' } },
      { type: 'slider-1', sortOrder: 1, url: '/a', title: 'A' },
      { type: 'slider-3', sortOrder: 0, active: false },
      { type: 'agent-slider-1', sortOrder: 0 },
    ]);
    expect(slides.map((slide) => slide.id)).toEqual(['slider-1', 'slider-2']);
    expect(slides[1]).toMatchObject({ href: '/sports', art: '/b', title: 'B' });
    expect(slides[0].href).toBeNull();
  });
});
