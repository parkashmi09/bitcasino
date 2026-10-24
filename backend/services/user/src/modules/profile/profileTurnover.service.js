'use strict';

const { money } = require('@ibitplay/common');

const { createRewardMoney } = require('../../lib/rewardMoney');
const { REASON } = require('../wallet/wallet.constants');

/**
 * `GET /user/profile/turnover`: the profile's Turnover block — total wager, required wager,
 * total deposit and progress — for one player, in one display currency.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT EACH NUMBER IS (and why it is not the reference's rollover)
 *
 * The reference site (addaplay `/deposits/check-wager/:uid`) shows a deposit ROLLOVER:
 * target = lifetime approved deposits × a multiplier (per player, else a site-wide one,
 * default 3), and refuses withdrawals until wager > target. This platform enforces no such
 * rule — fiat and crypto withdrawals check KYC, limits and the bonus lock, nothing else — so
 * showing "deposit × 3" here would invent a requirement the backend does not apply.
 *
 *   totalWager     every counted stake (`wager_activity`, not reversed): the same feed the VIP
 *                  ladder, rakeback and the bonus lock read. Casino stakes as they are counted,
 *                  sports stakes when the bet settles; a refunded / rolled-back stake is out.
 *   totalDeposit   every credited deposit: the wallet ledger's `DEPOSIT` rows (fiat approval,
 *                  crypto, PSP all write one), plus approved fiat deposits from before the
 *                  ledger existed (no `fiat-deposit:<id>` row) so an old deposit is not lost.
 *   required       the wagering the platform REALLY enforces: the sum of the player's ACTIVE
 *                  bonuses' `required_wager` (bonus × its multiplier, `player-bonuses`). Their
 *                  bonus is released to cash when it is met; a withdrawal before then forfeits it.
 *   wagered        what has been counted toward those active bonuses (`player_bonuses.wagered`),
 *                  so progress = wagered / required. It is NOT totalWager: stakes made before a
 *                  bonus was granted never counted toward it.
 *   remaining      required − wagered, per bonus, summed.
 *
 * No active bonus → required 0, progress null: nothing stands between the player and a
 * withdrawal on this account.
 *
 * ── CURRENCY ─────────────────────────────────────────────────────────────
 *
 * Amounts are summed per currency first (exact), then each total is converted ONCE into the
 * display currency `currency` through `rewardMoney.convert` (the `exchangerate` table, USD per
 * unit — the conversion every reward uses). Bonus figures convert from the bonus's own
 * currency (the reward currency it was granted in). A currency with no rate is left out of
 * the totals and NAMED in `unrated`, never counted at a guessed rate of 1. The per-currency
 * lists keep the exact amounts.
 *
 * The display currency is the player's pick (`?currency=`, the site's "View in"); without one,
 * or one with no rate, it is the reward currency.
 * ═════════════════════════════════════════════════════════════════════════
 */
const ZERO = '0.00000000';
const D = (value) => money.fromStored(String(value ?? '0'));
const add = (a, b) => money.toDecimalString(money.add(D(a), D(b)));
const sub = (a, b) => money.toDecimalString(money.subtract(D(a), D(b)));
const norm = (code) => String(code ?? '').trim().toUpperCase();

class ProfileTurnoverService {
  constructor(deps) {
    this.deps = deps;
    this.models = deps.models;
    this.db = deps.db;
    this.logger = deps.logger;
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
  }

  /** The bonus balance service, built on first use (it pulls in the wallet). */
  #bonuses() {
    if (this.deps.playerBonuses) return this.deps.playerBonuses;
    if (!this.playerBonuses) {
      const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
      this.playerBonuses = new PlayerBonusService(this.deps);
    }
    return this.playerBonuses;
  }

  async forPlayer(userId, { currency } = {}) {
    const [wagers, deposits, bonus, display] = await Promise.all([
      this.#wagers(userId),
      this.#deposits(userId),
      this.#bonuses().summary(userId),
      this.#displayCurrency(currency),
    ]);

    const unrated = new Set();
    const into = async (amount, from) => {
      const value = await this.#convert(amount, from, display);
      if (value == null) unrated.add(norm(from));
      return value;
    };
    const total = async (rows) => {
      let sum = ZERO;
      for (const r of rows) {
        const v = await into(r.amount, r.currency);
        if (v != null) sum = add(sum, v);
      }
      return sum;
    };

    let required = ZERO;
    let wagered = ZERO;
    let remaining = ZERO;
    for (const b of bonus.active) {
      const [req, done, left] = await Promise.all([
        into(b.requiredWager, b.currency), into(b.wagered, b.currency), into(b.remaining, b.currency),
      ]);
      if (req == null) continue;
      required = add(required, req);
      wagered = add(wagered, done);
      remaining = add(remaining, left);
    }

    return {
      asOf: new Date().toISOString(),
      currency: display,
      totalWager: await total(wagers),
      bets: wagers.reduce((n, r) => n + r.count, 0),
      totalDeposit: await total(deposits),
      deposits: deposits.reduce((n, r) => n + r.count, 0),
      required,
      wagered,
      remaining,
      progress: progressOf(wagered, required),
      activeBonuses: bonus.active.length,
      wageringLock: bonus.wageringLock,
      byCurrency: { wager: wagers, deposit: deposits },
      unrated: [...unrated].sort(),
    };
  }

  /** The asked-for currency when it has a rate; otherwise the reward currency. */
  async #displayCurrency(asked) {
    const reward = norm(await this.rewardMoney.currency());
    const code = norm(asked);
    if (!code || code === reward) return reward;
    return (await this.#convert('1', reward, code)) == null ? reward : code;
  }

  async #convert(amount, from, to) {
    try {
      return await this.rewardMoney.convert(D(amount), norm(from), norm(to));
    } catch (error) {
      this.logger?.warn({ err: error, from, to }, 'Turnover: conversion failed');
      return null;
    }
  }

  /** Counted, un-reversed stakes per currency. */
  async #wagers(userId) {
    const rows = await this.db.sequelize.query(
      `SELECT UPPER(currency) AS currency, SUM(amount) AS amount, COUNT(*)::int AS count
         FROM wager_activity
        WHERE user_id = :userId AND reversed_at IS NULL
        GROUP BY UPPER(currency)`,
      { replacements: { userId: String(userId) }, type: 'SELECT' }
    );
    return shapeRows(rows);
  }

  /** Credited deposits per currency: ledger `DEPOSIT` rows + pre-ledger approved fiat deposits. */
  async #deposits(userId) {
    const rows = await this.db.sequelize.query(
      `SELECT currency, SUM(amount) AS amount, SUM(count)::int AS count FROM (
         SELECT UPPER(COALESCE(currency, 'INR')) AS currency, amount, 1 AS count
           FROM credits_ledger
          WHERE user_id = :uid AND reason = :reason AND amount > 0
         UNION ALL
         SELECT UPPER(COALESCE(f.currency, 'INR')), f.amount, 1
           FROM fiat_deposits f
          WHERE f.user_id = :userId AND LOWER(f.status) = 'approved'
            AND NOT EXISTS (
              SELECT 1 FROM credits_ledger l WHERE l.idempotency_key = 'fiat-deposit:' || f.deposit_id
            )
       ) d
       GROUP BY currency`,
      { replacements: { uid: String(userId), userId: String(userId), reason: REASON.DEPOSIT }, type: 'SELECT' }
    );
    return shapeRows(rows);
  }
}

function shapeRows(rows) {
  return rows
    .map((r) => ({ currency: norm(r.currency), amount: D(r.amount), count: Number(r.count) || 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}

/** Percent with two decimals, floored (99.999 is not 100 until it is); null with nothing required. */
function progressOf(wagered, required) {
  if (!money.gt(D(required), '0')) return null;
  const pct = Number(money.divide(money.toDecimalString(money.multiply(D(wagered), '100')), D(required)));
  return Math.min(100, Math.floor(pct / 1e6) / 100);
}

module.exports = { ProfileTurnoverService, progressOf };
