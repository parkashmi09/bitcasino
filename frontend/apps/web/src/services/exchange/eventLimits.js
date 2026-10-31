/* Ported from TENEXCH frontend/src/apiservices/eventLimits.js, unchanged except the transport.
 * `GET /bet-limits/:eventId` → { success, limits: { "<market mid>": { min?, max? } } } (no `data`). */
// ─── Per-event min/max stake overrides (owner-set) ──────────────────────────
//
// GET /user/bet-limits/:eventId → { "<market_id>": { min?, max? } }.
//
// The market poll runs every 300ms, so this is deliberately split in two:
//   * fetchEventLimits() — one HTTP call per event, refreshed on the page's
//     existing ~30s tick. Never called from the poll itself.
//   * peekEventLimits()  — synchronous read of the last fetched map, used by
//     the render/poll path. Returns {} until the first fetch lands, which is
//     the right answer: no override until we know there is one.
//
// The server serves this from Redis, so the whole board hitting the same event
// costs one DB read per TTL.

import { exchangeRequest, POLL_TIMEOUT_MS } from './api';

const store = new Map(); // eventId -> { limits, fetchedAt }
const inFlight = new Map();
const TTL_MS = 30 * 1000;

export function peekEventLimits(eventId) {
  if (!eventId) return null;
  return store.get(String(eventId))?.limits || null;
}

export async function fetchEventLimits(eventId, { force = false } = {}) {
  if (!eventId) return null;
  const key = String(eventId);

  const held = store.get(key);
  if (!force && held && Date.now() - held.fetchedAt < TTL_MS) return held.limits;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = (async () => {
    let limits;
    try {
      const data = await exchangeRequest(`/bet-limits/${encodeURIComponent(key)}`, { timeout: POLL_TIMEOUT_MS });
      limits = data?.limits || {};
    } catch {
      // Keep whatever we already had rather than dropping an override on a
      // transient network blip; {} on a cold cache means "no override".
      limits = held?.limits || {};
    }
    store.set(key, { limits, fetchedAt: Date.now() });
    inFlight.delete(key);
    return limits;
  })();

  inFlight.set(key, request);
  return request;
}

// Apply this event's overrides to one market object. An override side wins over
// the feed; the other side is untouched. maxb is zeroed alongside max because
// resolveMarketLimits() on the server reads maxb FIRST for non-racing sports —
// leaving a stale maxb would make the slip show one cap and the API enforce
// another (this is the same reason applyMatchOddsLimits zeroes it).
export function applyLimitOverride(market, limits) {
  const entry = limits?.[String(market?.mid)];
  if (!entry) return market;

  const next = { ...market };
  if (Number(entry.min) > 0) next.min = Number(entry.min);
  if (Number(entry.max) > 0) {
    next.max = Number(entry.max);
    next.maxb = 0;
  }

  // Runners carry their own min/max and the bet slip prefers section.min /
  // section.max where present, so the override has to land there too.
  if (Array.isArray(next.section)) {
    next.section = next.section.map((section) => {
      const s = { ...section };
      if (Number(entry.min) > 0) s.min = Number(entry.min);
      if (Number(entry.max) > 0) s.max = Number(entry.max);
      return s;
    });
  }

  return next;
}

// Convenience for the poll path: overrides for `eventId` applied to a list.
export function applyEventLimits(markets, eventId) {
  const limits = peekEventLimits(eventId);
  if (!limits || !Object.keys(limits).length) return markets;
  return markets.map((market) => applyLimitOverride(market, limits));
}

export function resetEventLimitsCache() {
  store.clear();
  inFlight.clear();
}
