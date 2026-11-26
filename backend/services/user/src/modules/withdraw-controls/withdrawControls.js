'use strict';

const { money, defineErrors } = require('@ibitplay/common');

/**
 * Withdrawal controls (owner, 2026-11-24): an auto-send limit and per-player caps.
 *
 * ── THE SETTINGS (migration 202) ───────────────────────────────────────────
 *
 *   withdraw_controls         the site's rule per currency
 *   player_withdraw_limits    one player's override per currency
 *
 *   auto_limit    crypto only: a request BELOW it is sent through CCPayment at once. At or
 *                 above it, the request waits in the queue and staff approve it with their
 *                 transaction password (as before). Site-wide only; a player can be opted out
 *                 (`auto_allowed = false`).
 *   daily_count   withdrawals in any rolling 24 hours (crypto + manual + gateway, this currency)
 *   daily_amount  total withdrawn in any rolling 24 hours (crypto + manual + gateway, this currency)
 *   max_single    the largest single withdrawal
 *
 * A player's non-NULL value replaces the site's, and NULL falls back to it. No row and no
 * value means no limit. Empty tables mean everything is off.
 *
 * ── WHAT COUNTS ────────────────────────────────────────────────────────────
 *
 * Every crypto, manual (bank) and gateway payout of the currency in the last 24 hours, except the
 * refused / refunded ones (USAGE_SQL): the same rule as the owner's daily limit, so a player
 * cannot queue several requests past a cap.
 *
 * Checked INSIDE the rail's transaction, before its row and hold, under the same per-player lock
 * as the deposit cap (`withdraw-cap:<uid>`), so two requests at once cannot both fit.
 */

const errors = defineErrors('WITHDRAW', {
  /** Details `{ currency, limit, attempted }`. */
  MAX_SINGLE_EXCEEDED: { status: 403, message: 'This withdrawal is over the largest amount allowed' },
  /** Details `{ currency, limit, usedToday }`. */
  DAILY_COUNT_EXCEEDED: { status: 403, message: 'You have reached the number of withdrawals allowed in 24 hours' },
  /** Details `{ currency, limit, usedToday, remaining, attempted }`. */
  DAILY_AMOUNT_EXCEEDED: { status: 403, message: 'This withdrawal is over your 24-hour withdrawal amount' },
  /** Staff saving a limit for a player id that does not exist. */
  CONTROLS_PLAYER_NOT_FOUND: { status: 404, message: 'No such player' },
});

const FIELDS = Object.freeze(['autoLimit', 'dailyCount', 'dailyAmount', 'maxSingle']);
const NOT_OUT = `('rejected','declined','cancelled','canceled')`;
const WINDOW = `now() - interval '24 hours'`;

/**
 * The player's payouts of `cur` in the last 24 hours, on every rail the caps apply to: crypto,
 * manual (bank) and the gateway payouts (the Fiat tab). Same conditions as the owner's daily
 * limit (packages/common/src/withdrawalDailyLimit.js): refused / refunded rows do not count.
 */
const USAGE_SQL = `
  WITH out AS (
    SELECT amount::numeric AS amount FROM withdrawals
      WHERE uid = :uid AND upper(coin) = :cur AND lower(status) NOT IN ${NOT_OUT} AND date >= ${WINDOW}
    UNION ALL
    SELECT amount::numeric FROM fiat_withdrawals
      WHERE uid = :uid AND upper(currency) = :cur AND lower(status) NOT IN ${NOT_OUT} AND date >= ${WINDOW}
    UNION ALL
    SELECT amount::numeric FROM apaywithdrawals
      WHERE user_id = :uid AND upper(currency) = :cur
        AND refunded IS NOT TRUE AND lower(status) NOT IN ${NOT_OUT} AND created_at >= ${WINDOW}
    UNION ALL
    SELECT amount::numeric FROM pay_out_transactions
      WHERE user_id = :uid AND upper(currency) = :cur AND status IN (0, 1) AND created_at >= ${WINDOW}
    UNION ALL
    SELECT amount::numeric FROM f2paywithdrawals
      WHERE user_id = :uid AND upper(currency) = :cur
        AND refunded IS NOT TRUE AND lower(status) NOT IN ${NOT_OUT} AND created_at >= ${WINDOW}
  )
  SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM out`;

/** "1,234.5" — grouped, trailing zeros dropped. */
function fmt(value) {
  const [whole, fraction = ''] = String(value).split('.');
  const frac = fraction.replace(/0+$/, '');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

const dec = (v) => (v == null ? null : money.toDecimalString(money.toMinorQuantised(String(v))));
const int = (v) => (v == null ? null : Number(v));
const cur = (c) => String(c ?? '').trim().toUpperCase();

const siteOut = (r) => ({
  currency: r.currency,
  autoLimit: dec(r.auto_limit),
  dailyCount: int(r.daily_count),
  dailyAmount: dec(r.daily_amount),
  maxSingle: dec(r.max_single),
  updatedBy: r.updated_by == null ? null : String(r.updated_by),
  updatedAt: r.updated_at,
});

const playerOut = (r) => ({
  userId: String(r.user_id),
  username: r.username ?? null,
  currency: r.currency,
  dailyCount: int(r.daily_count),
  dailyAmount: dec(r.daily_amount),
  maxSingle: dec(r.max_single),
  autoAllowed: r.auto_allowed !== false,
  note: r.note ?? null,
  updatedBy: r.updated_by == null ? null : String(r.updated_by),
  updatedAt: r.updated_at,
});

/**
 * The effective rule from the site row and the player row (either may be null).
 * `autoLimit` is null when auto-send is off for this player.
 */
function resolve(site, player) {
  const pick = (p, s) => (p != null ? p : s ?? null);
  const autoAllowed = player ? player.auto_allowed !== false : true;
  return {
    autoLimit: autoAllowed ? dec(site?.auto_limit ?? null) : null,
    dailyCount: int(pick(player?.daily_count, site?.daily_count)),
    dailyAmount: dec(pick(player?.daily_amount, site?.daily_amount)),
    maxSingle: dec(pick(player?.max_single, site?.max_single)),
    autoAllowed,
  };
}

/** True when `amount` is strictly below the effective auto limit. */
function isUnderAutoLimit(rule, amount) {
  if (!rule?.autoLimit) return false;
  return money.toMinor(String(amount)) < money.toMinor(rule.autoLimit);
}

function createWithdrawControls(deps) {
  const { db, logger } = deps;
  const query = (sql, replacements, opts = {}) =>
    db.sequelize.query(sql, { replacements, type: 'SELECT', ...opts });

  async function rule(userId, currency, { transaction } = {}) {
    const c = cur(currency);
    const [site] = await query('SELECT * FROM withdraw_controls WHERE currency = :c', { c }, { transaction });
    const [player] = await query(
      'SELECT * FROM player_withdraw_limits WHERE user_id = :uid AND currency = :c',
      { uid: String(userId), c },
      { transaction }
    );
    return resolve(site ?? null, player ?? null);
  }

  async function usage(userId, currency, { transaction } = {}) {
    const [row] = await query(USAGE_SQL, { uid: String(userId), cur: cur(currency) }, { transaction });
    return { count: Number(row?.count ?? 0), total: dec(row?.total ?? '0') };
  }

  /**
   * The caps, inside the rail's transaction (before its row and hold). No limit set → no lock,
   * no query beyond the two settings reads. Answers the rule (the caller uses `autoLimit`).
   */
  async function assertInTransaction(userId, { amount, currency, transaction }) {
    const c = cur(currency);
    const r = await rule(userId, c, { transaction });
    const requested = money.toMinor(String(amount));
    const attempted = money.toDecimalString(requested);

    if (r.maxSingle && requested > money.toMinor(r.maxSingle)) {
      const details = { currency: c, limit: r.maxSingle, attempted };
      logger?.info({ userId: String(userId), ...details }, 'Withdrawal refused: over the largest single withdrawal');
      throw errors.MAX_SINGLE_EXCEEDED(details, {
        message: `The largest withdrawal allowed is ${fmt(r.maxSingle)} ${c}.`,
      });
    }
    if (r.dailyCount == null && !r.dailyAmount) return r;

    // The deposit cap's lock (withdrawRequirements.lockPlayer): re-entrant in this transaction.
    await db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `withdraw-cap:${userId}` },
      transaction,
    });
    const used = await usage(userId, c, { transaction });

    if (r.dailyCount != null && used.count >= r.dailyCount) {
      const details = { currency: c, limit: r.dailyCount, usedToday: used.count };
      logger?.info({ userId: String(userId), ...details }, 'Withdrawal refused: daily count reached');
      throw errors.DAILY_COUNT_EXCEEDED(details, {
        message: `You can make ${r.dailyCount} ${c} withdrawal${r.dailyCount === 1 ? '' : 's'} in 24 hours. Try again later.`,
      });
    }
    if (r.dailyAmount) {
      const cap = money.toMinor(r.dailyAmount);
      const spent = money.toMinor(used.total);
      if (spent + requested > cap) {
        const remaining = money.toDecimalString(cap > spent ? cap - spent : 0n);
        const details = { currency: c, limit: r.dailyAmount, usedToday: used.total, remaining, attempted };
        logger?.info({ userId: String(userId), ...details }, 'Withdrawal refused: over the 24-hour amount');
        throw errors.DAILY_AMOUNT_EXCEEDED(details, {
          message: money.gt(remaining, '0')
            ? `You can withdraw ${fmt(r.dailyAmount)} ${c} in 24 hours; ${fmt(remaining)} ${c} left.`
            : `24-hour withdrawal amount of ${fmt(r.dailyAmount)} ${c} reached. Try again later.`,
        });
      }
    }
    return r;
  }

  // ── Staff settings ────────────────────────────────────────────────────────

  async function listSite() {
    const rows = await query('SELECT * FROM withdraw_controls ORDER BY currency', {});
    return rows.map(siteOut);
  }

  async function saveSite(currency, values, staffId) {
    const c = cur(currency);
    const [row] = await query(
      `INSERT INTO withdraw_controls (currency, auto_limit, daily_count, daily_amount, max_single, updated_by, updated_at)
       VALUES (:c, :autoLimit, :dailyCount, :dailyAmount, :maxSingle, :by, now())
       ON CONFLICT (currency) DO UPDATE SET auto_limit = EXCLUDED.auto_limit, daily_count = EXCLUDED.daily_count,
         daily_amount = EXCLUDED.daily_amount, max_single = EXCLUDED.max_single,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      { c, ...nulls(values), by: staffId ?? null }
    );
    logger?.warn({ currency: c, ...values, staffId }, 'Withdrawal controls saved');
    return siteOut(row);
  }

  async function removeSite(currency, staffId) {
    const c = cur(currency);
    await query('DELETE FROM withdraw_controls WHERE currency = :c RETURNING currency', { c });
    logger?.warn({ currency: c, staffId }, 'Withdrawal controls removed');
    return { currency: c, removed: true };
  }

  async function listPlayers({ userId, limit = 50, offset = 0 } = {}) {
    const where = userId ? 'WHERE p.user_id = :uid' : '';
    const rows = await query(
      `SELECT p.*, u.name AS username FROM player_withdraw_limits p
         LEFT JOIN users u ON u.id = p.user_id ${where}
        ORDER BY p.updated_at DESC LIMIT :limit OFFSET :offset`,
      { uid: userId ? String(userId) : null, limit, offset }
    );
    const [{ total }] = await query(`SELECT COUNT(*)::int AS total FROM player_withdraw_limits p ${where}`, {
      uid: userId ? String(userId) : null,
    });
    return { total, rows: rows.map(playerOut) };
  }

  async function savePlayer(userId, currency, values, staffId) {
    const c = cur(currency);
    const [user] = await query('SELECT id FROM users WHERE id = :uid', { uid: String(userId) });
    if (!user) throw errors.CONTROLS_PLAYER_NOT_FOUND({ userId: String(userId) });
    const [row] = await query(
      `INSERT INTO player_withdraw_limits (user_id, currency, daily_count, daily_amount, max_single, auto_allowed, note, updated_by, updated_at)
       VALUES (:uid, :c, :dailyCount, :dailyAmount, :maxSingle, :autoAllowed, :note, :by, now())
       ON CONFLICT (user_id, currency) DO UPDATE SET daily_count = EXCLUDED.daily_count,
         daily_amount = EXCLUDED.daily_amount, max_single = EXCLUDED.max_single,
         auto_allowed = EXCLUDED.auto_allowed, note = EXCLUDED.note,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      {
        uid: String(userId),
        c,
        ...nulls(values),
        autoAllowed: values.autoAllowed !== false,
        note: values.note ?? null,
        by: staffId ?? null,
      }
    );
    logger?.warn({ userId: String(userId), currency: c, ...values, staffId }, 'Player withdrawal limits saved');
    return playerOut(row);
  }

  async function removePlayer(userId, currency, staffId) {
    const c = cur(currency);
    await query('DELETE FROM player_withdraw_limits WHERE user_id = :uid AND currency = :c RETURNING user_id', {
      uid: String(userId),
      c,
    });
    logger?.warn({ userId: String(userId), currency: c, staffId }, 'Player withdrawal limits removed');
    return { userId: String(userId), currency: c, removed: true };
  }

  return { rule, usage, assertInTransaction, listSite, saveSite, removeSite, listPlayers, savePlayer, removePlayer };
}

/** The four numeric fields, `undefined` → NULL (Sequelize replacements need every key). */
function nulls(values) {
  const out = {};
  for (const f of FIELDS) out[f] = values?.[f] ?? null;
  return out;
}

module.exports = { createWithdrawControls, resolve, isUnderAutoLimit, withdrawControlErrors: errors, USAGE_SQL };
