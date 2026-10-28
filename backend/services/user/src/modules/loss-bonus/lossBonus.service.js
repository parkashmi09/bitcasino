'use strict';

const { money, operatorSettings } = require('@ibitplay/common');
const { promotionsBlocked } = require('@ibitplay/auth');

const { createRewardMoney } = require('../../lib/rewardMoney');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { SOURCE } = require('../player-bonuses/playerBonus.constants');
const errors = require('./lossBonus.errors');

/**
 * Loss bonus (lossback): a share of a player's net loss over the last completed period, claimed
 * by the player after a confirmation (user, 2026-10-28 — the client's "loss bonus confirmation").
 *
 *   net loss  = −(casino P/L + sports P/L) over [period start, period end), in the reward currency
 *   bonus     = min(net loss × percent / 100, max)   — 0 below the minimum loss
 *
 * Casino: the wallet ledger's bet movements (stakes negative, payouts / refunds / rollbacks
 * positive), sports rows excluded. Sports: the exchange's settlement ledger P/L (profit + loss on
 * settlement / void / commission rows), the same figures the admin dashboard's sports GGR reads.
 * Every currency is converted at today's rate.
 *
 * Every term is the Super Admin's (site admin → Limits and policy → Loss bonus) and the switch is
 * OFF by default. The claim goes through PlayerBonusService.grant: locked until bonus × the wager
 * multiplier is staked (0 = straight to cash), exactly once per player and period (`grant_key`),
 * never for an agent-tree player.
 */

const DAY_MS = 86_400_000;
// Periods are counted from a Monday (UTC), so a 7-day period runs Monday to Monday.
const EPOCH_MS = Date.UTC(1970, 0, 5);
const ZERO = '0.00000000';
const PLAY_REASONS = ['BET_STAKE', 'BET_PAYOUT', 'BET_REFUND', 'BET_ROLLBACK'];
// The sports settlement ledger's P/L rows (admin dashboardStats SPORTS_LEDGER_REASONS).
const SPORTS_REASONS = ['settlement', 'settlement_void', 'commission', 'commission_void'];

// money's arithmetic returns minor units (bigint); every figure here is kept as a decimal string.
const D = (v) => money.toDecimalString(typeof v === 'bigint' ? v : money.toMinorQuantised(String(v ?? '0')));

/** The last completed period of `days` days before `now`, and when the current one ends. */
function lastPeriod(now, days) {
  const length = days * DAY_MS;
  const currentStart = EPOCH_MS + Math.floor((now.getTime() - EPOCH_MS) / length) * length;
  return { from: new Date(currentStart - length), to: new Date(currentStart), nextAt: new Date(currentStart + length) };
}

/** `net loss × percent`, floored by the minimum loss and capped by the maximum (0 = no cap). */
function bonusFor(netLoss, { percent, minLoss, maxBonus }) {
  if (!money.gt(netLoss, '0') || money.lt(netLoss, minLoss)) return ZERO;
  let bonus = D(money.divide(D(money.multiply(netLoss, percent)), '100'));
  if (money.gt(maxBonus, '0') && money.gt(bonus, maxBonus)) bonus = D(maxBonus);
  return bonus;
}

class LossBonusService {
  constructor(deps) {
    this.deps = deps;
    this.models = deps.models;
    this.db = deps.db;
    this.logger = deps.logger;
    this.settings = deps.operatorSettings ?? operatorSettings(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    this.playerBonuses = deps.playerBonuses ?? new PlayerBonusService({ ...deps, rewardMoney: this.rewardMoney });
    this.now = deps.now ?? (() => new Date());
  }

  /** The Super Admin's terms; unreadable = off. */
  async terms() {
    const read = (key, fallback) => this.settings.read(key, fallback);
    const [enabled, percent, days, minLoss, maxBonus, multiplier] = await Promise.all([
      read('loss_bonus_enabled', false),
      read('loss_bonus_percent', '10'),
      read('loss_bonus_period_days', 7),
      read('loss_bonus_min_loss', '0'),
      read('loss_bonus_max', '0'),
      read('loss_bonus_wager_multiplier', '1'),
    ]);
    const periodDays = Math.min(31, Math.max(1, Math.trunc(Number(days)) || 7));
    return {
      enabled: String(enabled) === 'true',
      percent: D(percent),
      periodDays,
      minLoss: D(minLoss),
      maxBonus: D(maxBonus),
      wagerMultiplier: Number(multiplier) > 0 ? Number(multiplier) : 0,
    };
  }

  /** Per currency P/L (positive = the player won) over [from, to). */
  async #pnl(userId, from, to) {
    const { sequelize } = this.db;
    const replacements = { userId: String(userId), from, to, play: PLAY_REASONS, sports: SPORTS_REASONS };
    return sequelize.query(
      `SELECT UPPER(currency) AS currency, SUM(amount)::text AS pnl
         FROM public.credits_ledger
        WHERE user_id = :userId AND created_at >= :from AND created_at < :to AND reason IN (:play)
          AND bet_id IS NULL AND sport_id IS NULL AND match_id IS NULL
        GROUP BY 1
       UNION ALL
       SELECT UPPER(currency), SUM(COALESCE(profit, 0) + COALESCE(loss, 0))::text
         FROM mssports.credits_ledger
        WHERE user_id = :userId AND created_at >= :from AND created_at < :to AND reason IN (:sports)
        GROUP BY 1`,
      { replacements, type: sequelize.QueryTypes.SELECT }
    );
  }

  /** Net loss over [from, to) in the reward currency (0 for a net win). A currency with no rate is skipped. */
  async netLoss(userId, from, to) {
    const currency = await this.rewardMoney.currency();
    let pnl = ZERO;
    for (const row of await this.#pnl(userId, from, to)) {
      const value = await this.rewardMoney.convert(D(row.pnl), row.currency, currency);
      if (value == null) {
        this.logger?.warn({ userId: String(userId), currency: row.currency }, 'Loss bonus: no rate — currency left out');
        continue;
      }
      pnl = D(money.add(pnl, value));
    }
    return { currency, netLoss: money.lt(pnl, '0') ? D(money.multiply(pnl, '-1')) : ZERO };
  }

  #grantKey(userId, period, days) {
    return `loss-bonus:${userId}:${period.from.toISOString().slice(0, 10)}:${days}d`;
  }

  /** What the player can see: the terms, the last period, its net loss, the bonus and whether it is claimed. */
  async summary(userId) {
    const terms = await this.terms();
    const period = lastPeriod(this.now(), terms.periodDays);
    const base = {
      enabled: terms.enabled,
      percent: terms.percent,
      periodDays: terms.periodDays,
      minLoss: terms.minLoss,
      maxBonus: terms.maxBonus,
      wagerMultiplier: terms.wagerMultiplier,
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      nextPeriodAt: period.nextAt.toISOString(),
    };
    if (!terms.enabled) return { ...base, currency: await this.rewardMoney.currency(), netLoss: ZERO, bonus: ZERO, claimed: false, claimable: false };

    const { currency, netLoss } = await this.netLoss(userId, period.from, period.to);
    const bonus = bonusFor(netLoss, terms);
    const claimed = Boolean(
      await this.models.PlayerBonus.findOne({
        where: { grant_key: this.#grantKey(userId, period, terms.periodDays) },
        attributes: ['id'],
        raw: true,
      })
    );
    return { ...base, currency, netLoss, bonus, claimed, claimable: !claimed && money.gt(bonus, '0') };
  }

  /** The player confirmed: pay the last period's loss bonus, once. */
  async claim(userId) {
    const terms = await this.terms();
    if (!terms.enabled) throw errors.DISABLED();
    if (await promotionsBlocked(userId)) throw errors.NOT_ELIGIBLE();

    const period = lastPeriod(this.now(), terms.periodDays);
    const { currency, netLoss } = await this.netLoss(userId, period.from, period.to);
    const bonus = bonusFor(netLoss, terms);
    if (!money.gt(bonus, '0')) throw errors.NOTHING_TO_CLAIM({ netLoss, currency });

    const result = await this.playerBonuses.grant({
      userId,
      source: SOURCE.LOSS_BONUS,
      grantKey: this.#grantKey(userId, period, terms.periodDays),
      ref: `LOSS_BONUS:${period.from.toISOString().slice(0, 10)}`,
      currency,
      amount: bonus,
      wagerMultiplier: terms.wagerMultiplier,
      description: `Loss bonus ${terms.percent}% of ${netLoss} ${currency}`,
    });
    if (!result.paid) {
      if (result.reason === 'ALREADY_PAID') throw errors.ALREADY_CLAIMED();
      throw errors.NOT_ELIGIBLE({ reason: result.reason });
    }
    this.logger?.info({ userId: String(userId), netLoss, bonus, currency, locked: result.locked }, 'Loss bonus claimed');
    return { ...result, netLoss, percent: terms.percent, period: { from: period.from.toISOString(), to: period.to.toISOString() } };
  }
}

module.exports = { LossBonusService, lastPeriod, bonusFor };
