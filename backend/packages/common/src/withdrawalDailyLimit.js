'use strict';

const money = require('./money');

const QueryTypes = Object.freeze({ SELECT: 'SELECT' });

/**
 * Daily withdrawal limit per currency — the owner's switch next to the deposit cap, the signed
 * document's `withdrawalDailyLimit` block (owner panel → Features & plan → Withdrawals).
 *
 *   { enabled: boolean, limits: { INR: "50000", USDT: "500" } }
 *
 * A player may withdraw at most `limits[currency]` of that currency in any ROLLING 24 HOURS
 * (not a calendar day: no midnight reset to queue against). A currency with no entry has no
 * daily limit. An older document (no block) reads as off, so nothing changes on a live site until
 * the owner switches it on.
 *
 * ── WHAT COUNTS (per currency, in that currency, never converted) ─────────
 *   The deposit cap's own "withdrawn" rule (withdrawalCapFigures.js): pending and paid count,
 *   rejected / declined / cancelled and failed-and-refunded do not — so a player cannot queue
 *   several requests past the limit. Plus P2P sell orders, which are payouts too (the operator's
 *   withdrawal block already treats them so): PENDING, RELEASED and
 *   DISPUTED count, CANCELLED / EXPIRED do not. Agent collections (staff_transfers) are not a
 *   player's withdrawal and are not counted; agent-tree players never reach a rail anyway.
 *
 * Enforced on every rail that sends money out — fiat (bank), crypto, gateway payouts, P2P sell —
 * inside the rail's transaction under the same per-player lock as the deposit cap
 * (user-service modules/withdraw-requirements), so two requests at once cannot both fit.
 */

const DEFAULTS = Object.freeze({ enabled: false, limits: Object.freeze({}) });

/** A currency code: uppercase letter, then 1–9 uppercase letters or digits (currencies.js). */
const CODE_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** A limit: a positive decimal string, at most 8 places, at most MAX_LIMIT. */
const MAX_LIMIT = '1000000000000';
const AMOUNT_RE = /^\d{1,13}(\.\d{1,8})?$/;
const FIELDS = Object.freeze(['enabled', 'limits']);

const isLimit = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return false;
  const s = String(v).trim();
  if (!AMOUNT_RE.test(s)) return false;
  const minor = money.toMinor(s);
  return minor > 0n && minor <= money.toMinor(MAX_LIMIT);
};

const normalise = (v) => money.toDecimalString(money.toMinor(String(v).trim()));

/** Reading (the entitlements store, every reader): known fields; a bad currency or amount is dropped. */
function cleanWithdrawalDailyLimit(value) {
  const given = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const limits = {};
  const raw = given.limits && typeof given.limits === 'object' && !Array.isArray(given.limits) ? given.limits : {};
  for (const [code, amount] of Object.entries(raw)) {
    const cur = String(code).toUpperCase();
    if (CODE_RE.test(cur) && isLimit(amount)) limits[cur] = normalise(amount);
  }
  return {
    enabled: typeof given.enabled === 'boolean' ? given.enabled : DEFAULTS.enabled,
    limits,
  };
}

/** Saving (strict, mirrored by the owner panel): the first problem, or null. */
function withdrawalDailyLimitProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'withdrawalDailyLimit must be an object';
  const extra = Object.keys(value).find((k) => !FIELDS.includes(k));
  if (extra) return `withdrawalDailyLimit.${extra} is not a field (${FIELDS.join(', ')})`;
  if (typeof value.enabled !== 'boolean') return 'withdrawalDailyLimit.enabled must be true or false';
  if (!value.limits || typeof value.limits !== 'object' || Array.isArray(value.limits)) {
    return 'withdrawalDailyLimit.limits must be an object of currency → amount';
  }
  for (const [code, amount] of Object.entries(value.limits)) {
    if (!CODE_RE.test(code)) return `withdrawalDailyLimit.limits: ${code} is not a currency code (upper case, e.g. INR)`;
    if (!isLimit(amount)) return `withdrawalDailyLimit.limits.${code} must be an amount above 0 and at most ${MAX_LIMIT}, with at most 8 decimals`;
  }
  if (value.enabled && Object.keys(value.limits).length === 0) return 'withdrawalDailyLimit: add at least one currency, or switch it off';
  return null;
}

/** The limit for one currency while the switch is on (decimal string), else null. */
function limitFor(block, currency) {
  const b = cleanWithdrawalDailyLimit(block);
  if (!b.enabled) return null;
  return b.limits[String(currency ?? '').toUpperCase()] ?? null;
}

/** `{ limit, used, remaining }` from the two decimal strings; remaining is floored at zero. */
function computeDaily({ limit, used }) {
  const cap = money.toMinor(String(limit));
  const out = money.toMinorQuantised(String(used ?? '0'));
  const spent = out > 0n ? out : 0n;
  return {
    limit: money.toDecimalString(cap),
    used: money.toDecimalString(spent),
    remaining: money.toDecimalString(cap > spent ? cap - spent : 0n),
  };
}

const NOT_OUT = `('rejected','declined','cancelled','canceled')`;
const WINDOW = `now() - interval '24 hours'`;

/** What left (or is held to leave) the player's `cur` wallet in the last 24 hours, every rail. */
const USED_SQL = `
  SELECT
      (SELECT COALESCE(SUM(amount), 0) FROM fiat_withdrawals
        WHERE uid = :uid AND upper(currency) = :cur AND lower(status) NOT IN ${NOT_OUT} AND date >= ${WINDOW})
    + (SELECT COALESCE(SUM(amount), 0) FROM withdrawals
        WHERE uid = :uid AND upper(coin) = :cur AND lower(status) NOT IN ${NOT_OUT} AND date >= ${WINDOW})
    + (SELECT COALESCE(SUM(amount), 0) FROM apaywithdrawals
        WHERE user_id = :uidText AND upper(currency) = :cur
          AND refunded IS NOT TRUE AND lower(status) NOT IN ${NOT_OUT} AND created_at >= ${WINDOW})
    + (SELECT COALESCE(SUM(amount), 0) FROM pay_out_transactions
        WHERE user_id = :uid AND upper(currency) = :cur AND status IN (0, 1) AND created_at >= ${WINDOW})
    + (SELECT COALESCE(SUM(crypto_amount), 0) FROM p2p_orders_sell
        WHERE user_id = :uidText AND upper(coin) = :cur
          AND upper(status) IN ('PENDING','RELEASED','DISPUTED') AND created_at >= ${WINDOW})
    -- Tips sent leave the account too: without them a limited player tips a friend who withdraws.
    + (SELECT COALESCE(SUM(amount), 0) FROM tips
        WHERE from_user_id = :uid AND upper(currency) = :cur AND created_at >= ${WINDOW})
    AS total`;

/** The rolling-24h usage reader, on the connection the caller uses (inside its transaction). */
function createDailyFigures({ db }) {
  async function used(userId, currency, { transaction } = {}) {
    const [row] = await db.sequelize.query(USED_SQL, {
      replacements: { uid: String(userId), uidText: String(userId), cur: String(currency).toUpperCase() },
      type: QueryTypes.SELECT,
      transaction,
    });
    return money.toDecimalString(money.toMinorQuantised(String(row?.total ?? '0')));
  }
  return { used };
}

module.exports = {
  DEFAULTS,
  MAX_LIMIT,
  FIELDS,
  cleanWithdrawalDailyLimit,
  withdrawalDailyLimitProblem,
  limitFor,
  computeDaily,
  isLimit,
  createDailyFigures,
  USED_SQL,
};
