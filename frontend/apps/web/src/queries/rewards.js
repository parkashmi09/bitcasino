import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ENDPOINTS } from '@/lib/endpoints';
import { queryKeys } from '@/queries/keys';
import { refreshBalances } from '@/hooks/useWallet';
import { useAuth } from '@/auth/AuthProvider';

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
    const { card, name } = data.unranked;
    tiers.push({ card, name: name || 'Beginner', minXp: '0', maxXp: String(Number(levels[0].minXp) - 1), levels: 1 });
  }
  for (const level of levels) {
    const last = tiers[tiers.length - 1];
    if (last?.card === level.card) {
      last.maxXp = level.maxXp;
      last.levels += 1;
    } else {
      tiers.push({ card: level.card, name: title(level.card), minXp: level.minXp, maxXp: level.maxXp, levels: 1 });
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
    enabled: status !== 'loading',
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
    mutationFn: ({ code }) => api(ENDPOINTS.bonusRedeem, { method: 'POST', body: { code } }),
    retry: false,
    onSuccess: () => refreshBalances(),
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
    mutationFn: () => api(ENDPOINTS.rakebackClaim, { method: 'POST' }),
    retry: false,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.rewards.rakeback() });
      refreshBalances();
    },
  });
}
