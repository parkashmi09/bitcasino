'use strict';

const { money, operatorSettings } = require('@ibitplay/common');
const { promotionsBlocked } = require('@ibitplay/auth');

const { createRewardMoney } = require('../../lib/rewardMoney');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { SOURCE, UNLOCK_MODE } = require('../player-bonuses/playerBonus.constants');
const { notifyBonus } = require('../notifications/notifyPlayer');
const errors = require('./lossBonus.errors');

/**
 * Loss bonus (lossback): a share of a player's net loss over a window, claimed by the player after
 * a confirmation (user, 2026-10-28 — the client's "loss bonus confirmation"). Built as hash.game's
 * Welcome Shield (user, 2026-10-29; its /activity/bonus/fx/lossback/ terms: 20%, up to $300, 24H
 * protection after the first deposit, max bet per bet, AUTO settled when the window ends, 48H to
 * claim, 0x wager).
 *
 *   window    = Welcome Shield: [first deposit, + protection hours) — once per player
 *               otherwise:      the last completed period of `period days` — once per period
 *   net loss  = −(casino P/L + sports P/L) over the window, in the reward currency; a bet whose
 *               stake (sports: loss) is over the max bet per bet does not count as a loss
 *   bonus     = min(net loss × percent / 100, max)   — 0 below the minimum loss
 *   claimable = once the window has ended, until `claim hours` after (0 = no expiry)
 *
 * Casino: the wallet ledger's bet movements written by casino-service (stakes negative, payouts /
 * refunds / rollbacks positive) — the statements' rule; sports writes the same reasons from its
 * own service, and an Original's rows carry a bet_id, so neither column can tell them apart. Sports: the exchange's settlement ledger P/L (profit + loss on
 * settlement / void / commission rows), the same figures the admin dashboard's sports GGR reads.
 * Every currency is converted at today's rate.
 *
 * Every term is the Super Admin's (site admin → Limits and policy → Loss bonus) and the switch is
 * OFF by default. The claim goes through PlayerBonusService.grant: locked until bonus × the wager
 * multiplier is staked (0 = straight to cash), exactly once per player and period (`grant_key`),
 * never for an agent-tree player.
 *
 * Added 2026-11-24 (user; plan docs/plans/2026-11-24-deposit-and-loss-bonus-rules.md), each a
 * Limits and policy switch, all OFF by default:
 *   auto credit        the `loss-bonus:auto-credit` job grants it when the window ends (no claim);
 *                      the manual claim stays for anything the job has not reached yet
 *   requires deposit   granted waiting (`activated_at` NULL) — usable only after the player's next
 *                      deposit credited after the grant
 *   stake share %      each bet is paid that share from the bonus (10 = 90 cash + 10 bonus), see
 *                      PlayerBonusService UNLOCK_MODE.STAKE_SHARE; the wager multiplier then
 *                      does not apply
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Periods are counted from a Monday (UTC), so a 7-day period runs Monday to Monday.
const EPOCH_MS = Date.UTC(1970, 0, 5);
const ZERO = '0.00000000';
// Auto credit with no claim expiry: how far back the job looks for a window that ended.
const AUTO_LOOKBACK_HOURS = 7 * 24;
// Error codes `claim` throws for "nothing to pay for this player now" — quiet in the job.
const QUIET = new Set(['LOSS_BONUS_NOTHING_TO_CLAIM', 'LOSS_BONUS_ALREADY_CLAIMED', 'LOSS_BONUS_NOT_SETTLED', 'LOSS_BONUS_EXPIRED', 'LOSS_BONUS_NO_DEPOSIT', 'LOSS_BONUS_NOT_ELIGIBLE']);
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
    const [enabled, welcome, hours, days, percent, maxBonus, minLoss, maxBet, claimHours, multiplier, auto, requiresDeposit, share] = await Promise.all([
      read('loss_bonus_enabled', false),
      read('loss_bonus_welcome', true),
      read('loss_bonus_protection_hours', 24),
      read('loss_bonus_period_days', 7),
      read('loss_bonus_percent', '20'),
      read('loss_bonus_max', '0'),
      read('loss_bonus_min_loss', '0'),
      read('loss_bonus_max_bet', '0'),
      read('loss_bonus_claim_hours', 48),
      read('loss_bonus_wager_multiplier', '0'),
      read('loss_bonus_auto_credit', false),
      read('loss_bonus_requires_deposit', false),
      read('loss_bonus_stake_share_percent', '0'),
    ]);
    const whole = (v, min, max, fallback) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback));
    return {
      enabled: String(enabled) === 'true',
      welcome: String(welcome) !== 'false',
      protectionHours: whole(hours, 1, 720, 24),
      periodDays: whole(days, 1, 31, 7),
      percent: D(percent),
      maxBonus: D(maxBonus),
      minLoss: D(minLoss),
      maxBet: D(maxBet),
      claimHours: whole(claimHours, 0, 720, 48),
      wagerMultiplier: Number(multiplier) > 0 ? Number(multiplier) : 0,
      autoCredit: String(auto) === 'true',
      requiresDeposit: String(requiresDeposit) === 'true',
      stakeSharePercent: Math.min(100, Math.max(0, Number.isFinite(Number(share)) ? Number(share) : 0)),
    };
  }

  /** Per currency P/L (positive = the player won) over [from, to). */
  async #pnl(userId, from, to, maxBet) {
    const { sequelize } = this.db;
    const replacements = { userId: String(userId), from, to, play: PLAY_REASONS, sports: SPORTS_REASONS };
    const rows = await sequelize.query(
      `SELECT UPPER(currency) AS currency, SUM(amount)::text AS pnl
         FROM public.credits_ledger
        WHERE user_id = :userId AND created_at >= :from AND created_at < :to AND reason IN (:play)
          AND source_service = 'casino-service'
        GROUP BY 1
       UNION ALL
       SELECT UPPER(currency), SUM(COALESCE(profit, 0) + COALESCE(loss, 0))::text
         FROM mssports.credits_ledger
        WHERE user_id = :userId AND created_at >= :from AND created_at < :to AND reason IN (:sports)
        GROUP BY 1`,
      { replacements, type: sequelize.QueryTypes.SELECT }
    );
    if (!money.gt(maxBet, '0') || !rows.length) return rows;

    /* Max bet per bet: a bet over the limit (casino stake, sports loss — the limit converted to
       each currency) is left out of the loss. shortcut: its payout still counts as a win (stakes
       and payouts are not paired across providers) — in the house's favour; pair them if a
       player disputes it. */
    const reward = await this.rewardMoney.currency();
    const limits = {};
    for (const { currency } of rows) {
      const limit = await this.rewardMoney.convert(maxBet, reward, currency);
      if (limit != null) limits[currency] = limit;
    }
    const over = await sequelize.query(
      `WITH l AS (SELECT key AS currency, value::numeric AS lim FROM jsonb_each_text(CAST(:limits AS jsonb)))
       SELECT l.currency, SUM(c.amount)::text AS pnl
         FROM public.credits_ledger c JOIN l ON l.currency = UPPER(c.currency)
        WHERE c.user_id = :userId AND c.created_at >= :from AND c.created_at < :to AND c.reason = 'BET_STAKE'
          AND c.source_service = 'casino-service' AND -c.amount > l.lim
        GROUP BY 1
       UNION ALL
       SELECT l.currency, SUM(s.loss)::text
         FROM mssports.credits_ledger s JOIN l ON l.currency = UPPER(s.currency)
        WHERE s.user_id = :userId AND s.created_at >= :from AND s.created_at < :to AND s.reason IN (:sports)
          AND -COALESCE(s.loss, 0) > l.lim
        GROUP BY 1`,
      { replacements: { ...replacements, limits: JSON.stringify(limits) }, type: sequelize.QueryTypes.SELECT }
    );
    // Taking the over-limit losses back out: P/L − (their negative sum).
    return rows.concat(over.map((r) => ({ currency: r.currency, pnl: D(money.multiply(D(r.pnl), '-1')) })));
  }

  /** Net loss over [from, to) in the reward currency (0 for a net win). A currency with no rate is skipped. */
  async netLoss(userId, from, to, maxBet = ZERO) {
    const currency = await this.rewardMoney.currency();
    let pnl = ZERO;
    for (const row of await this.#pnl(userId, from, to, maxBet)) {
      const value = await this.rewardMoney.convert(D(row.pnl), row.currency, currency);
      if (value == null) {
        this.logger?.warn({ userId: String(userId), currency: row.currency }, 'Loss bonus: no rate — currency left out');
        continue;
      }
      pnl = D(money.add(pnl, value));
    }
    return { currency, netLoss: money.lt(pnl, '0') ? D(money.multiply(pnl, '-1')) : ZERO };
  }

  /** When the player's first deposit was credited (null = none yet). */
  async #firstDepositAt(userId) {
    const { sequelize } = this.db;
    const [row] = await sequelize.query(
      `SELECT MIN(created_at) AS at FROM public.credits_ledger WHERE user_id = :userId AND reason = 'DEPOSIT'`,
      { replacements: { userId: String(userId) }, type: sequelize.QueryTypes.SELECT }
    );
    return row?.at ? new Date(row.at) : null;
  }

  /** The window this claim is for, its grant key, and when its claim expires (null = never). */
  async #window(userId, terms) {
    const now = this.now();
    let from;
    let to;
    let grantKey;
    if (terms.welcome) {
      const first = await this.#firstDepositAt(userId);
      if (!first) return null;
      from = first;
      to = new Date(first.getTime() + terms.protectionHours * HOUR_MS);
      grantKey = `loss-bonus:${userId}:welcome`;
    } else {
      ({ from, to } = lastPeriod(now, terms.periodDays));
      grantKey = `loss-bonus:${userId}:${from.toISOString().slice(0, 10)}:${terms.periodDays}d`;
    }
    const expiresAt = terms.claimHours > 0 ? new Date(to.getTime() + terms.claimHours * HOUR_MS) : null;
    return { from, to, grantKey, expiresAt, ended: now >= to, expired: Boolean(expiresAt && now >= expiresAt) };
  }

  /**
   * What the player can see: the terms, the window, its net loss so far, the bonus and its state —
   * `no_deposit` (Welcome Shield, nothing deposited yet), `active` (window still running),
   * `claimable`, `claimed`, `expired`, `none` (no loss to pay back).
   */
  async summary(userId) {
    const terms = await this.terms();
    const base = { ...terms, currency: await this.rewardMoney.currency(), netLoss: ZERO, bonus: ZERO, claimed: false, claimable: false };
    if (!terms.enabled) return { ...base, state: 'none' };

    const window = await this.#window(userId, terms);
    if (!window) return { ...base, state: 'no_deposit' };

    const { netLoss } = await this.netLoss(userId, window.from, window.to, terms.maxBet);
    const bonus = bonusFor(netLoss, terms);
    const granted = await this.models.PlayerBonus.findOne({
      where: { grant_key: window.grantKey }, attributes: ['id', 'activated_at', 'status'], raw: true,
    });
    const claimed = Boolean(granted);
    const state = claimed
      ? 'claimed'
      : !window.ended
        ? 'active'
        : !money.gt(bonus, '0')
          ? 'none'
          : window.expired
            ? 'expired'
            : 'claimable';
    return {
      ...base,
      netLoss,
      bonus,
      claimed,
      claimable: state === 'claimable',
      state,
      // Granted but usable only after the player's next deposit ("Requires a new deposit").
      waitingForDeposit: Boolean(granted && granted.status === 'active' && granted.activated_at == null),
      period: { from: window.from.toISOString(), to: window.to.toISOString() },
      claimExpiresAt: window.expiresAt?.toISOString() ?? null,
    };
  }

  /** The player confirmed: pay the window's loss bonus, once. */
  async claim(userId) {
    const terms = await this.terms();
    if (!terms.enabled) throw errors.DISABLED();
    if (await promotionsBlocked(userId)) throw errors.NOT_ELIGIBLE();

    const window = await this.#window(userId, terms);
    if (!window) throw errors.NO_DEPOSIT();
    if (!window.ended) throw errors.NOT_SETTLED({ settlesAt: window.to.toISOString() });
    if (window.expired) throw errors.EXPIRED();

    const { currency, netLoss } = await this.netLoss(userId, window.from, window.to, terms.maxBet);
    const bonus = bonusFor(netLoss, terms);
    if (!money.gt(bonus, '0')) throw errors.NOTHING_TO_CLAIM({ netLoss, currency });

    const result = await this.playerBonuses.grant({
      userId,
      source: SOURCE.LOSS_BONUS,
      grantKey: window.grantKey,
      ref: `LOSS_BONUS:${terms.welcome ? 'welcome' : window.from.toISOString().slice(0, 10)}`,
      currency,
      amount: bonus,
      wagerMultiplier: terms.wagerMultiplier,
      ...(terms.stakeSharePercent > 0
        ? { unlockMode: UNLOCK_MODE.STAKE_SHARE, unlockRate: String(terms.stakeSharePercent / 100) }
        : {}),
      activated: !terms.requiresDeposit,
      description:
        `Loss bonus ${terms.percent}% of ${netLoss} ${currency}` +
        (terms.stakeSharePercent > 0 ? `, ${terms.stakeSharePercent}% of each bet` : '') +
        (terms.requiresDeposit ? ', usable after your next deposit' : ''),
    });
    if (!result.paid) {
      if (result.reason === 'ALREADY_PAID') throw errors.ALREADY_CLAIMED();
      throw errors.NOT_ELIGIBLE({ reason: result.reason });
    }
    this.logger?.info({ userId: String(userId), netLoss, bonus, currency, locked: result.locked }, 'Loss bonus claimed');
    return {
      ...result, netLoss, percent: terms.percent, waitingForDeposit: result.locked === true && result.activated === false,
      period: { from: window.from.toISOString(), to: window.to.toISOString() },
    };
  }

  /**
   * The `loss-bonus:auto-credit` job: with auto credit on, grant every ended window's bonus that is
   * not granted yet — the same `claim` (same checks, same `grant_key`, so exactly once, and a
   * player's manual claim racing it pays once). Candidates are the players who played in the window
   * (period mode) or whose protection hours ended recently (Welcome Shield).
   */
  async autoGrantDue() {
    const terms = await this.terms();
    if (!terms.enabled || !terms.autoCredit) return { checked: 0, granted: 0 };
    const users = await this.#candidates(terms);
    let granted = 0;
    for (const userId of users) {
      try {
        const result = await this.claim(userId);
        granted += 1;
        void notifyBonus(userId, {
          key: `bonus:loss:${result.period.from.slice(0, 10)}`,
          title: result.waitingForDeposit ? 'Loss bonus — deposit to use it' : 'Loss bonus added',
          amount: result.amount,
          currency: result.currency,
        });
      } catch (error) {
        if (QUIET.has(error?.code)) continue;
        this.logger?.warn({ err: error, userId: String(userId) }, 'Loss bonus auto credit failed for a player');
      }
    }
    if (granted) this.logger?.info({ checked: users.length, granted }, 'Loss bonus auto credit');
    return { checked: users.length, granted };
  }

  /** Players with a window that has ended and no grant under its key yet. */
  async #candidates(terms) {
    const { sequelize } = this.db;
    const now = this.now();
    let ids;
    let keyOf;
    if (terms.welcome) {
      const lookback = (terms.claimHours > 0 ? terms.claimHours : AUTO_LOOKBACK_HOURS) * HOUR_MS;
      const endedBefore = new Date(now.getTime() - terms.protectionHours * HOUR_MS);
      const rows = await sequelize.query(
        `SELECT user_id::text AS user_id FROM public.credits_ledger WHERE reason = 'DEPOSIT'
          GROUP BY user_id HAVING MIN(created_at) <= :endedBefore AND MIN(created_at) > :since`,
        { replacements: { endedBefore, since: new Date(endedBefore.getTime() - lookback) }, type: sequelize.QueryTypes.SELECT }
      );
      ids = rows.map((r) => r.user_id);
      keyOf = (u) => `loss-bonus:${u}:welcome`;
    } else {
      const { from, to } = lastPeriod(now, terms.periodDays);
      const rows = await sequelize.query(
        `SELECT DISTINCT user_id::text AS user_id FROM public.credits_ledger
          WHERE created_at >= :from AND created_at < :to AND reason IN (:play) AND source_service = 'casino-service'
         UNION
         SELECT DISTINCT user_id::text FROM mssports.credits_ledger
          WHERE created_at >= :from AND created_at < :to AND reason IN (:sports)`,
        { replacements: { from, to, play: PLAY_REASONS, sports: SPORTS_REASONS }, type: sequelize.QueryTypes.SELECT }
      );
      ids = rows.map((r) => r.user_id);
      const day = from.toISOString().slice(0, 10);
      keyOf = (u) => `loss-bonus:${u}:${day}:${terms.periodDays}d`;
    }
    if (!ids.length) return [];
    const done = await this.models.PlayerBonus.findAll({
      where: { grant_key: ids.map(keyOf) }, attributes: ['grant_key'], raw: true,
    });
    const paid = new Set(done.map((r) => r.grant_key));
    return ids.filter((u) => !paid.has(keyOf(u)));
  }
}

module.exports = { LossBonusService, lastPeriod, bonusFor };
