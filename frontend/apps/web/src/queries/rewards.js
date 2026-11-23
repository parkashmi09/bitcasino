import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { queryKeys } from '@/queries/keys';
import { refreshBalances } from '@/hooks/useWallet';
import { useAuth } from '@/auth/AuthProvider';
import { AGENT_SITE } from '@/lib/agentBase';
import { subscribe } from '@/lib/socket';
import { walletKeys } from '@/queries/wallet';

/**
 * Rewards, rakeback and the VIP standing — the account's own bonus surfaces.
 *
 * Every amount is a decimal STRING and is formatted, never parsed. Every
 * claim is `retry: false` and calls `refreshBalances()`, for the reasons
 * `useClaimBonus` in `promotions.js` gives.
 *
 * Callers pass `enabled: false` for a section whose gate is off: an agent's
 * player is refused these with `*_NOT_FOR_AGENT_USERS`.
 */

/* ── VIP ─────────────────────────────────────────────────────────────── */

/** The player's standing. `GET /user/vip`, behind the `vip` gate. */
export function useVipStanding({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.vip(),
    queryFn: ({ signal }) => api(ENDPOINTS.vip, { signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/** Claims every waiting rank-up; true when something was paid. One attempt: a failure waits for the next trigger. */
export async function claimWaitingRankUps({ read = () => api(ENDPOINTS.vipRankUps), claim = () => api(ENDPOINTS.vipRankUpsClaim, { method: 'POST' }) } = {}) {
  const waiting = await read();
  if (!waiting?.cards?.length) return false;
  const paid = await claim();
  return Boolean(paid?.granted?.length);
}

/**
 * Hash pays a VIP rank-up with the level-up; this backend holds it behind a claim. So the signed-in
 * site claims for the player: once on session load, and again on a `vip_rank_up` notification push.
 * `enabled` only where VIP is on for this player (never an agent's player or a demo account).
 */
export function useVipRankUps({ enabled }) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    let running = false;
    let again = false;
    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        if ((await claimWaitingRankUps()) && live) {
          refreshBalances();
          client.invalidateQueries({ queryKey: walletKeys.all });
          client.invalidateQueries({ queryKey: queryKeys.rewards.all });
        }
      } catch {
        // Not retried here: the next rank-up or session load asks again.
      }
      running = false;
      if (again && live) {
        again = false;
        run();
      }
    };
    run();
    const off = subscribe('notificationsUnread', (frame) => {
      if (frame?.notification?.kind === 'vip_rank_up') run();
    });
    return () => {
      live = false;
      off();
    };
  }, [enabled, client]);
}

/** The ladder, grouped into tiers by `card`. Public. */
export function useVipTiers() {
  return useQuery({
    queryKey: queryKeys.rewards.vipLevels(),
    queryFn: ({ signal }) => api(ENDPOINTS.vipLevels, { auth: false, signal }),
    select: toTiers,
    staleTime: 10 * 60 * 1000,
  });
}

/** Tier art for the `/loyalty` cards, in ladder order — the page's seven pictures. */
const TIER_ART = ['beginner', 'fan', 'expert', 'master', 'guru', 'legend', 'hero2'].map(
  (name) => `/images/loyalty/tier-${name}.png`,
);

const title = (card) => String(card ?? '').replace(/^\w/, (c) => c.toUpperCase());

/**
 * `{unranked, levels}` → one tier per `card` (bronze, silver, …), unranked
 * first: `{card, name, points: '1000 - 29999', levels}`. The open-ended top
 * band prints `… - ...` as the page always has.
 */
export function toTiers(data) {
  const levels = Array.isArray(data?.levels) ? data.levels : [];
  const tiers = [];
  if (data?.unranked && levels[0]) {
    const { card, name, multiplier, milestones } = data.unranked;
    tiers.push({ card, name: name || 'Beginner', minXp: '0', maxXp: String(Number(levels[0].minXp) - 1), levels: 1, multiplier, milestones });
  }
  for (const level of levels) {
    const last = tiers[tiers.length - 1];
    if (last?.card === level.card) {
      last.maxXp = level.maxXp;
      last.levels += 1;
    } else {
      // Loyalty Club ladder: one level per tier, with the multiplier and milestones it publishes.
      const name = level.multiplier != null ? level.name : title(level.card);
      tiers.push({ card: level.card, name, minXp: level.minXp, maxXp: level.maxXp, levels: 1, multiplier: level.multiplier, milestones: level.milestones });
    }
  }
  return tiers.map(({ minXp, maxXp, ...tier }, index) => ({
    ...tier,
    points: `${minXp} - ${maxXp ?? '...'}`,
    art: TIER_ART[Math.min(index, TIER_ART.length - 1)],
  }));
}

/* ── The first-deposit offer ─────────────────────────────────────────── */

/** Public with an optional session; signed in, it also says whether THIS player can get it. */
export function useFirstDepositOffer() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.firstDeposit(status),
    queryFn: ({ signal }) => api(ENDPOINTS.firstDeposit, { signal }),
    enabled: status !== 'loading' && !AGENT_SITE,
    select: toDepositOffer,
    staleTime: 60 * 1000,
  });
}

/**
 * The terms as one offer, or null when there is nothing this account can get.
 * A `monthly` program offers only this month's next step (hash-game-exchange's
 * `toRechargeConfig`); otherwise every tier with a percentage.
 */
export function toDepositOffer(terms) {
  if (!terms?.enabled || !terms.eligible) return null;
  const program = terms.program;
  const monthly = program?.mode === 'monthly';
  const tiers = (
    monthly ? [program.schedule?.[Number(program.usedThisMonth) || 0]] : (terms.tiers ?? [])
  ).filter((tier) => Number(tier?.percent) > 0);
  if (!tiers.length) return null;

  const top = Math.max(...tiers.map((tier) => Number(tier.percent)));
  const lowest = tiers.reduce((a, b) => (Number(b.minDeposit) < Number(a.minDeposit) ? b : a));
  return {
    id: monthly ? 'monthly-deposit' : 'first-deposit',
    title: monthly ? `Deposit bonus – ${top}%` : `First deposit bonus – up to ${top}%`,
    currency: String(terms.currency ?? 'USDT'),
    minDeposit: String(lowest.minDeposit),
    tiers: tiers.map((tier) => ({
      minDeposit: String(tier.minDeposit),
      percent: Number(tier.percent),
      // `0.00` is "no cap" on the platform.
      maxBonus: Number(tier.maxBonus) > 0 ? String(tier.maxBonus) : null,
    })),
    wagerMultiplier: Number(terms.wagerMultiplier) || null,
    wageringLock: terms.wageringLock !== false,
    // A gradual-unlock program locks the bonus even with no multiplier.
    gradual: program?.unlockMode === 'gradual',
    expiryDays: Number(terms.expiryDays) || null,
  };
}

/* ── Locked bonuses ──────────────────────────────────────────────────── */

/** `{wageringLock, currency, balances, active, history}`. No feature gate on the platform. */
export function useBonusBalance({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.bonusBalance(),
    queryFn: ({ signal }) => api(ENDPOINTS.bonusBalance, { signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/** Claim what the gradual bonuses have unlocked so far — all of them, in one call. */
export function useClaimUnlocked() {
  const client = useQueryClient();
  return useMutation({
    meta: { success: 'Rewards claimed to your balance.' },
    mutationFn: () => api(ENDPOINTS.bonusBalanceClaim, { method: 'POST' }),
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.rewards.bonusBalance() });
      refreshBalances();
    },
  });
}

/** Redeem a code for a fixed amount. `bonus` gate. */
export function useRedeemCode() {
  return useMutation({
    meta: { success: 'Code redeemed.' },
    mutationFn: ({ code }) => api(ENDPOINTS.bonusRedeem, { method: 'POST', body: { code } }),
    retry: false,
    onSuccess: () => refreshBalances(),
  });
}

/* ── Loss bonus ──────────────────────────────────────────────────────── */

/** The loss bonus terms and the last window's result; `state` drives the button. */
export function useLossBonus({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.lossBonus(),
    queryFn: ({ signal }) => api(ENDPOINTS.lossBonus, { signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

export function useClaimLossBonus() {
  const client = useQueryClient();
  return useMutation({
    meta: { success: 'Loss bonus claimed.' },
    mutationFn: () => api(ENDPOINTS.lossBonusClaim, { method: 'POST' }),
    retry: false,
    onSuccess: () => {
      // The payout may land in the bonus balance (wager-locked) as well as the loss-bonus card.
      client.invalidateQueries({ queryKey: queryKeys.rewards.all });
      refreshBalances();
    },
  });
}

/* ── Rakeback ────────────────────────────────────────────────────────── */

/** `{amount, currency, amountUsd, claimable, minimum, rate}` — `rate` is a fraction of stake. */
export function useRakeback({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.rakeback(),
    queryFn: ({ signal }) => api(ENDPOINTS.rakeback, { signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

export function useClaimRakeback() {
  const client = useQueryClient();
  return useMutation({
    meta: { success: 'Rakeback claimed.' },
    mutationFn: () => api(ENDPOINTS.rakebackClaim, { method: 'POST' }),
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.rewards.rakeback() });
      refreshBalances();
    },
  });
}

/* ── Wagering (the deposit rollover) ─────────────────────────────────── */

/** `{scope, multiplier, tasks}` — empty `tasks` before any deposit. Amounts are USD. */
export function useWagerTasks({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.wagerTasks(),
    queryFn: ({ signal }) => api(ENDPOINTS.wagerTasks, { signal }),
    enabled: enabled && status === 'authenticated',
    staleTime: 30 * 1000,
  });
}

/* ── Reload rewards ──────────────────────────────────────────────────── */

const authed = (status, enabled) => enabled && status === 'authenticated';

/** `{vipLevel, DAILY_RELOAD, PRE_MONTHLY}` — each program's state for this player. `bonus` gate. */
export function useReloadRewards({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.reload(),
    queryFn: ({ signal }) => api(ENDPOINTS.reloadRewards, { signal }),
    enabled: authed(status, enabled),
    staleTime: 30 * 1000,
  });
}

/** The Daily Reload day by day: `{days: [{date, earnedUsd, state}], today}`. */
export function useReloadCalendar({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.reloadCalendar(),
    queryFn: ({ signal }) => api(ENDPOINTS.reloadCalendar, { signal }),
    enabled: authed(status, enabled),
    staleTime: 60 * 1000,
  });
}

/** Everything received, per kind, in USD: `{daily, weekly, …, total}`. */
export function useReloadSummary({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.reloadSummary(),
    queryFn: ({ signal }) => api(ENDPOINTS.reloadSummary, { signal }),
    enabled: authed(status, enabled),
    staleTime: 60 * 1000,
  });
}

export function useClaimReload() {
  const client = useQueryClient();
  return useMutation({
    meta: { success: 'Reload claimed.' },
    mutationFn: (program) => api(path(ENDPOINTS.reloadClaim, { program }), { method: 'POST' }),
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.rewards.reload() });
      client.invalidateQueries({ queryKey: queryKeys.rewards.reloadSummary() });
      refreshBalances();
    },
  });
}

/* ── Medals (cosmetic, open to every player) ─────────────────────────── */

export function useMedals() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.medals(),
    queryFn: ({ signal }) => api(ENDPOINTS.medals, { signal }),
    enabled: status === 'authenticated',
    staleTime: 60 * 1000,
  });
}

/* ── Gift cards ──────────────────────────────────────────────────────── */

/** Every card this player can see, with their standing on it. `giftCards` gate. */
export function useGiftCards({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.giftCards(),
    queryFn: ({ signal }) => api(ENDPOINTS.giftCards, { signal }),
    select: (rows) => (Array.isArray(rows) ? rows : []),
    enabled: authed(status, enabled),
    staleTime: 30 * 1000,
  });
}

export function useGiftCardsClaimed({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.giftCardsClaimed(),
    queryFn: ({ signal }) => api(ENDPOINTS.giftCardsClaimed, { query: { limit: 20 }, signal }),
    select: (rows) => (Array.isArray(rows) ? rows : []),
    enabled: authed(status, enabled),
    staleTime: 60 * 1000,
  });
}

/** `activate` starts the card's clock; `claim` pays it once its conditions are met. */
export function useGiftCardAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, giftCardId }) =>
      api(action === 'claim' ? ENDPOINTS.giftCardClaim : ENDPOINTS.giftCardActivate, { method: 'POST', body: { giftCardId } }),
    retry: false,
    onSuccess: (_data, { action }) => {
      client.invalidateQueries({ queryKey: queryKeys.rewards.giftCards() });
      if (action === 'claim') {
        client.invalidateQueries({ queryKey: queryKeys.rewards.giftCardsClaimed() });
        refreshBalances();
      }
    },
  });
}

/* ── Casino free spins and jackpots (GIS) ────────────────────────────── */

/** The caller's active free-spin campaigns: `[{id, game, currency, quantity, quantityLeft, validUntil}]`. */
export function useMyFreespins({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.freespins(),
    queryFn: ({ signal }) => api(ENDPOINTS.gisFreespinsMine, { signal }),
    select: (data) => (Array.isArray(data?.freespins) ? data.freespins : []),
    enabled: authed(status, enabled),
    retry: false,
    staleTime: 60 * 1000,
  });
}

/** The aggregator's jackpots (503 without a GIS merchant, which the ticker shows as nothing). */
export function useJackpots({ enabled = true } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.rewards.jackpots(),
    queryFn: ({ signal }) => api(ENDPOINTS.gisJackpots, { signal }),
    select: toJackpots,
    enabled: authed(status, enabled),
    retry: false,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * The server shapes it as `[{name, amount (decimal string), currency, gameId?, raw}]`; the older
 * wrapped forms (`{items|jackpots|data}`) are still read so a stale gateway shows the same ticker.
 */
export function toJackpots(data) {
  const rows = Array.isArray(data) ? data : (data?.items ?? data?.jackpots ?? data?.data ?? []);
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      id: String(row?.id ?? row?.jackpot_id ?? index),
      name: String(row?.name ?? row?.title ?? 'Jackpot'),
      amount: row?.amount ?? row?.value ?? row?.balance ?? null,
      currency: String(row?.currency ?? ''),
    }))
    .filter((row) => row.amount != null && Number.isFinite(Number(row.amount)));
}
