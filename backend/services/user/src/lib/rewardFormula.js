'use strict';

/**
 * hash.game's rakeback + recurring bonus formula (siteconfig.vip_reward_formula, migration 137),
 * read from admin-service and cached 5 s. Percents as strings.
 *
 * With no admin client (tests, a broken wiring) this answers mode 'fixed' — the per-card amounts
 * in vipRewards.js — rather than inventing rates. An unreachable admin-service keeps the last
 * value it read.
 */
const INTERNAL_PATH = '/internal/admin/site-config/reward-formula';
const TTL_MS = 5_000;
const FIXED = Object.freeze({ mode: 'fixed' });

function createRewardFormula({ clients, logger, ttlMs = TTL_MS } = {}) {
  let cached = { value: null, expires: 0 };
  return async function read() {
    if (!clients?.admin) return FIXED;
    if (cached.value && cached.expires > Date.now()) return cached.value;
    try {
      const body = await clients.admin.get(INTERNAL_PATH);
      cached = { value: body?.mode === 'hash' ? { ...body } : FIXED, expires: Date.now() + ttlMs };
    } catch (error) {
      logger?.warn({ err: error }, 'Reward formula unreadable — keeping the last one');
      cached = { value: cached.value ?? FIXED, expires: Date.now() + ttlMs };
    }
    return cached.value;
  };
}

/** `[start, end)` of the period that has just closed, by hash.game's windows (all UTC). */
function closedWindow(type, now = new Date()) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (type === 'daily') return { start: new Date(day - 86_400_000), end: new Date(day) };
  if (type === 'weekly') {
    // Friday 00:00 → Thursday 23:59; the window that closed at the most recent Friday.
    const back = (new Date(day).getUTCDay() - 5 + 7) % 7;
    const end = day - back * 86_400_000;
    return { start: new Date(end - 7 * 86_400_000), end: new Date(end) };
  }
  // monthly: the 15th → the 14th; closed at the most recent 15th.
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const end = now.getUTCDate() >= 15 ? Date.UTC(y, m, 15) : Date.UTC(y, m - 1, 15);
  const e = new Date(end);
  return { start: new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 1, 15)), end: e };
}

module.exports = { createRewardFormula, closedWindow, INTERNAL_PATH, FIXED };
