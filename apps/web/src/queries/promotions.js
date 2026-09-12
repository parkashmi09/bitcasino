import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiWithMeta } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { queryKeys } from '@/queries/keys';
import { refreshBalances } from '@/hooks/useWallet';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The promotions surfaces: the spin wheel, the VIP standing, and the
 * operator's scheduled bonus events.
 *
 * @see docs/10-backend-integration.md, Phase 7.
 */

/* ═══════════════════════════════════════════════════════════════════════
 * The spin wheel
 *
 * Three routes and they have three different audiences, which is the shape
 * of the feature rather than an accident: a signed-out visitor may SEE the
 * prizes (that is marketing), only a player may know whether they can spin,
 * and only a player may spin.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The wheel's segments. **Public** — a visitor sees the prizes before signing
 * up, which is the whole point of putting a wheel on a promotions page.
 *
 * Answers `{slices, disabled}`. `disabled: true` with an empty list is the
 * operator having switched the wheel off; that is a state to render, not an
 * error to retry. Weights are NOT included on the public route — the odds are
 * the house's, and the shape of the wheel would give them away.
 */
export function useSpinSlices() {
  return useQuery({
    queryKey: queryKeys.promotions.spinSlices(),
    queryFn: ({ signal }) => api(ENDPOINTS.spinSlices, { auth: false, signal }),
    select: (data) => ({
      slices: Array.isArray(data?.slices) ? data.slices : [],
      disabled: Boolean(data?.disabled),
    }),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Whether this player may spin now.
 *
 * `{eligible, firstSpin, nextEligibleAt}`. **`firstSpin` is the field that
 * changes what the button says**: the first spin is free, and every one after
 * it needs a qualifying deposit. A button reading "Spin" at somebody who will
 * be refused with `SPINWHEEL_DEPOSIT_REQUIRED` is worse than one that says so.
 */
export function useSpinEligibility() {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.promotions.spinEligibility(),
    queryFn: ({ signal }) => api(ENDPOINTS.spinEligibility, { signal }),
    enabled: status === 'authenticated',
    // A cooldown expires on a clock, so a stale "not yet" outlives its truth.
    staleTime: 0,
  });
}

/**
 * Spin.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NO MONEY MOVES HERE, AND THE SCREEN MUST NOT SAY OTHERWISE.
 *
 * The reply is `{slice, isBadLuck, redeemCode, rewardPct}`. The service is
 * explicit at its own return: "the percentage is applied to the next deposit,
 * so no money moves here". What the player receives is a **redeem code** — a
 * bonus percentage they can spend on a future deposit — not a credit.
 *
 * "You won 20%" printed beside a balance would be describing a different
 * feature, and a player who then checked their wallet would find nothing.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `retry: false`: a spin is metered and consumes the player's turn. An
 * automatic retry after a timeout spends a second one they did not ask for.
 */
export function useSpin() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api(ENDPOINTS.spin, { method: 'POST' }),
    retry: false,
    onSuccess: () => {
      // The cooldown started, so the eligibility answer is now wrong.
      client.invalidateQueries({ queryKey: queryKeys.promotions.spinEligibility() });
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * VIP and the periodic bonuses
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The player's VIP standing and the three periodic bonuses, in one read.
 *
 * `{vip: {level, card, wager, nextLevel, wagerToNextLevel, progressPct},
 *   currency, types: {daily, weekly, monthly}}`
 *
 * **`eligible` and `claimable` are different things**, and a screen that
 * collapsed them would lie in one direction or the other. `eligible` is
 * whether the account's VIP level has reached the bonus's `minVipLevel`;
 * `claimable` is whether there is something to take right now. A player at
 * level 0 looking at a daily bonus with `minVipLevel: 20` is not "not yet
 * claimable" — they are twenty levels away, and that is the useful sentence.
 *
 * Every amount is a decimal STRING and is formatted, never parsed.
 */
export function useBonus() {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.promotions.bonus(),
    queryFn: ({ signal }) => api(ENDPOINTS.bonus, { signal }),
    enabled: status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/**
 * Claim one of the three periodic bonuses.
 *
 * `:type` is `daily` | `weekly` | `monthly`. Refused with a `BONUS_*` code
 * when the level is too low or the window has not come round — both of which
 * the card should already have prevented, so a refusal here means the read
 * was stale rather than that the player did something wrong.
 *
 * `retry: false` and `refreshBalances()` for the same reasons as every other
 * mutation that moves money: a claim is not idempotent, and the header chip's
 * `useBalances` is not a React Query hook, so `invalidateQueries` would match
 * nothing. See the note in `hooks/useWallet.js`.
 */
export function useClaimBonus() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ type }) =>
      api(path(ENDPOINTS.bonusClaim, { type }), { method: 'POST' }),
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.promotions.bonus() });
      refreshBalances();
    },
  });
}

/**
 * The player's own bonus log — every bonus this account has been paid.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * NOT THE OPERATOR'S SCHEDULED PROMOTIONS, WHICH IS WHAT THE ROUTE'S NAME
 * AND `docs/10`'s PHASE 7 BULLET BOTH SUGGEST.
 *
 * `GET /user/bonus/events` reads `bonushistory` scoped to the caller. A row
 * is `{id, userId, event, amount, createdAt, updatedAt}` — a name, a sum and
 * a date. **No title, no description, no window**, because it is a log of
 * what happened rather than a schedule of what will.
 *
 * There is no scheduled-promotions surface on this platform to read instead:
 * no `bonus_events` table, no tournaments table, nothing an operator fills
 * with a promotion that has a start and an end. That is a gap in the
 * backend, and `pages/Promotions.jsx` says so on the page rather than
 * implying the operator simply has not scheduled anything.
 *
 * This mattered less than it should have because `bonushistory` is empty on
 * this deployment, so the page's empty state was all anyone ever saw. The
 * shape it was reading — `name`, `description`, `startDate` — would have
 * produced a list of headings reading "Promotion" over blank date ranges the
 * moment one bonus was paid.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Page-based, `meta.pagination`. Player-scoped, so it needs a session.
 */
export function useBonusEvents({ page = 1, limit = 20 } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.promotions.events({ page, limit }),
    queryFn: ({ signal }) =>
      apiWithMeta(ENDPOINTS.bonusEvents, { query: { page, limit }, signal }),
    enabled: status === 'authenticated',
    select: ({ data, meta }) => ({
      /**
       * Mapped to the fields the row actually has, rather than passed
       * through for a component to guess at. `amount` stays a decimal
       * string — it is `NUMERIC` on the wire, like every other sum here.
       */
      events: (Array.isArray(data) ? data : []).map((row) => ({
        id: row?.id ?? null,
        // `event` is free text written by whatever paid the bonus —
        // `daily`, `weekly`, a campaign name. There is no enum to map it to.
        name: row?.event || 'Bonus',
        amount: String(row?.amount ?? '0'),
        at: row?.createdAt ?? null,
      })),
      pagination: meta?.pagination ?? null,
    }),
    staleTime: 60 * 1000,
  });
}
