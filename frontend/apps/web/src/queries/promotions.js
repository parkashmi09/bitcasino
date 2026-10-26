import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiWithMeta } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { queryKeys } from '@/queries/keys';
import { refreshBalances } from '@/hooks/useWallet';
import { useAuth } from '@/auth/AuthProvider';
import { formatBalance } from '@/lib/format';

/**
 * The promotions surfaces: the spin wheel, the VIP standing, the player's
 * bonus log, the wager races, the operator's promotions and the home slides.
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
 * The operator's campaigns are `usePromotions` below (`GET /admin/promotions`).
 *
 * This mattered less than it should have because `bonushistory` is empty on
 * this deployment, so the page's empty state was all anyone ever saw. The
 * shape it was reading — `name`, `description`, `startDate` — would have
 * produced a list of headings reading "Promotion" over blank date ranges the
 * moment one bonus was paid.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `limit`/`offset` on the wire (`page` is mapped), `meta.pagination` back. Player-scoped.
 */
export function useBonusEvents({ page = 1, limit = 20 } = {}) {
  const { status } = useAuth();

  return useQuery({
    queryKey: queryKeys.promotions.events({ page, limit }),
    queryFn: ({ signal }) =>
      // The validator is strict `limit`/`offset`; `page` would be a 422.
      apiWithMeta(ENDPOINTS.bonusEvents, { query: { limit, offset: (page - 1) * limit }, signal }),
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

/* ═══════════════════════════════════════════════════════════════════════
 * Wager races — the League page, Tournaments and My participations
 *
 * Owner feature `races` (gate `contest`). Every read is public; a token adds
 * the caller's own `me` row to a board. A switched-off race still answers a
 * board (pool 0, nothing paid), so `enabled` on the config is what decides
 * whether it is advertised — never "there is a board".
 * ═══════════════════════════════════════════════════════════════════════ */

const RACE_TITLES = { daily: 'Daily race', weekly: 'Weekly race' };
export const raceTitle = (type) => RACE_TITLES[type] ?? 'Race';

/** No row is off; a row without `enabled` is on (the backend's own rule). */
export const raceOn = (config) =>
  Boolean(config) && config.enabled !== false && config.configured !== false;

/** The race configs that are switched on, daily first. */
export function useRaces({ enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.promotions.races(),
    queryFn: ({ signal }) => api(ENDPOINTS.races, { auth: false, signal }),
    select: (rows) => (Array.isArray(rows) ? rows : []).filter(raceOn),
    enabled,
    staleTime: 60 * 1000,
  });
}

/** One open board per type, each with the viewer's own `me` (null signed out or not on it). */
export function useRaceBoards(types) {
  const { user } = useAuth();
  const viewer = user?.id ?? null;

  return useQueries({
    queries: types.map((type) => ({
      queryKey: queryKeys.promotions.raceBoard(type, viewer),
      queryFn: ({ signal }) => api(path(ENDPOINTS.raceBoard, { type }), { signal }),
      staleTime: 60 * 1000,
    })),
  });
}

/** Settled races, newest paid first, each with its podium. */
export function useRaceHistory({ limit = 30, enabled = true } = {}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.promotions.raceHistory(limit, user?.id ?? null),
    queryFn: ({ signal }) => api(ENDPOINTS.raceHistory, { query: { limit }, signal }),
    select: (rows) => (Array.isArray(rows) ? rows : []),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

const RACE_ART = {
  daily: '/images/tournaments/silver-big.avif',
  weekly: '/images/tournaments/gold-big.avif',
};

/**
 * A board (open) or a history row (settled) as `TournamentCard` draws one.
 * The open pool is the payout-currency figure the board quotes; a settled
 * race carries its own priced pool.
 */
export function toTournament(race, { finished = false } = {}) {
  const pool = finished
    ? `${formatBalance(race.prizePool)} ${race.currency ?? ''}`
    : `${formatBalance(race.payoutPrizePool ?? race.prizePool)} ${race.payoutCurrency ?? race.currency ?? ''}`;
  const leader = finished ? race.winners?.[0]?.name : race.leaderboard?.[0]?.name;

  return {
    slug: finished ? `race-${race.raceId}` : race.type,
    title: finished ? `${raceTitle(race.type)} #${race.raceId}` : raceTitle(race.type),
    art: RACE_ART[race.type] ?? RACE_ART.daily,
    status: finished ? 'finished' : 'active',
    prizePool: pool.trim(),
    leader: leader ?? '—',
    endsAt: race.endsAt,
    href: finished ? null : `/promotions/league-of-bitcasino?race=${race.type}`,
  };
}

/** `/tournaments`: the open boards of the races that are on, and the settled ones. */
export function useTournaments() {
  const races = useRaces();
  const boards = useRaceBoards((races.data ?? []).map((race) => race.type));
  const history = useRaceHistory();

  return {
    active: boards.filter((board) => board.data).map((board) => toTournament(board.data)),
    finished: (history.data ?? []).map((race) => toTournament(race, { finished: true })),
    isPending: races.isPending || history.isPending || boards.some((board) => board.isPending),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * Operator promotions — owner feature `promotions` (`GET /admin/promotions`)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Ended is the operator's `promoStatus` or an `endsAt` already past. */
export function toPromotionCard(row, now = Date.now()) {
  const ended =
    row?.promoStatus === 'ended' || (row?.endsAt ? new Date(row.endsAt).getTime() < now : false);

  return {
    slug: `${row.segment}-${row.slug}`,
    title: row.title ?? '',
    blurb: row.summary ?? '',
    href: `/promotions/${row.segment}/${row.slug}`,
    // Every seeded row has art; a row without any gets a neutral card rather than a broken image.
    art: row.imageUrl ?? '/images/banners/league.svg',
    ended,
  };
}

/**
 * Every published promotion, as `{live, past}` cards. The validator is
 * strict (`page`, `limit`, `segment`, `search`), so the split is done here
 * over one page of the maximum 100.
 */
export function usePromotions({ enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.promotions.list(),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.promotionList, { query: { limit: 100 }, auth: false, signal }),
    select: (rows) => {
      const cards = (Array.isArray(rows) ? rows : [])
        .filter((row) => row?.segment && row?.slug)
        .map((row) => toPromotionCard(row));
      return { live: cards.filter((c) => !c.ended), past: cards.filter((c) => c.ended) };
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** One promotion with its body: `description` and `termsHtml` are operator HTML. */
export function usePromotion(segment, slug) {
  return useQuery({
    queryKey: queryKeys.promotions.detail(segment, slug),
    queryFn: ({ signal }) =>
      api(path(ENDPOINTS.promotionBySlug, { segment, slug }), { auth: false, signal }),
    enabled: Boolean(segment && slug),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * Home slides — `GET /admin/banners?mode=direct`
 *
 * The site admin names slides `slider-<n>`; `home_top_<n>` is the older
 * name. A row is the image plus optional copy (`title`, `subtitle`, `cta`).
 * An empty answer is normal and the caller keeps its own art.
 * ═══════════════════════════════════════════════════════════════════════ */

const SLIDE_PLACEMENT = /^(slider-|home_top_)\d+$/;

export function toSlides(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => SLIDE_PLACEMENT.test(row?.type ?? '') && row.active !== false)
    .sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.type.localeCompare(b.type, undefined, { numeric: true }),
    )
    .map((row) => ({
      id: row.type,
      title: row.title ?? '',
      blurb: row.subtitle ?? '',
      href: row.cta?.href ?? null,
      art: row.url ?? path(ENDPOINTS.bannerImage, { filename: row.type }),
    }));
}

export function useHomeSlides({ enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.content.slides(),
    queryFn: ({ signal }) =>
      api(ENDPOINTS.banners, { query: { mode: 'direct' }, auth: false, signal }),
    select: toSlides,
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}
