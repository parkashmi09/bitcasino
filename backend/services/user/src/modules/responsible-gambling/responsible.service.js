'use strict';

const { Op } = require('@ibitplay/db');
const { money } = require('@ibitplay/common');

const errors = require('./responsible.errors');
const {
  EXCLUSION_TYPE,
  LIMIT_TYPE,
  PERIOD_UNIT,
  BREAK_PERIODS,
  COOLDOWN_MS,
  LIMIT_REMOVAL_DELAY_MS,
} = require('./responsible.constants');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { assertPlayerVisible } = require('../directory/playerScope');
const { betUsage } = require('../../lib/betUsage');

const DAY_MS = 24 * 60 * 60 * 1000;

/** `money`'s arithmetic answers BigInt minor units; this turns one back into a decimal string. */
const dec = (minor) => money.toDecimalString(minor);

/** `from` moved on by a break length (`BREAK_PERIODS` entry). */
function addSpan(from, { days = 0, months = 0 }) {
  const at = new Date(from);
  if (days) at.setTime(at.getTime() + days * DAY_MS);
  if (months) at.setUTCMonth(at.getUTCMonth() + months);
  return at;
}

/**
 * The start of the limit window `now` falls in. Windows restart on the anniversary of the limit's
 * creation: every 24 hours, every 7 days, or on the same day of each month.
 */
function windowStart(createdAt, unit, now = new Date()) {
  const start = new Date(createdAt);
  if (unit === PERIOD_UNIT.DAYS || unit === PERIOD_UNIT.WEEKS) {
    const len = unit === PERIOD_UNIT.DAYS ? DAY_MS : 7 * DAY_MS;
    return new Date(start.getTime() + Math.floor((now - start) / len) * len);
  }
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  let at = addSpan(start, { months });
  if (at > now) at = addSpan(start, { months: months - 1 });
  return at;
}

/** When the window that started at `from` ends. */
function windowEnd(from, unit) {
  if (unit === PERIOD_UNIT.DAYS) return addSpan(from, { days: 1 });
  if (unit === PERIOD_UNIT.WEEKS) return addSpan(from, { days: 7 });
  return addSpan(from, { months: 1 });
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** A break as the player site reads it (the reference's field names). */
const shapeExclusion = (row) => ({
  id: String(row.id),
  selfExclusionType: row.type,
  createdAt: iso(row.created_at),
  selfExclusionUntilAt: iso(row.until_at),
  selfExclusionCooldownUntilAt: iso(row.cooldown_until_at),
});

/**
 * A player's own breaks and limits (rainbet) — the server side of the player site's
 * `/responsible-gambling` tabs, and the check the wallet runs on every stake.
 *
 * Every write is the player's own and only ever makes them SAFER: a break cannot be shortened,
 * and a limit asked to go keeps applying for twelve hours (migration 163).
 */
class ResponsibleService {
  constructor(deps) {
    const { models, db, logger } = deps;
    this.deps = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
  }

  // ══ Player ══════════════════════════════════════════════════════════

  /** Breaks in force and live limits (with what the current window has used). */
  async overview(userId) {
    const now = new Date();
    const [exclusions, limits] = await Promise.all([this.#activeExclusions(userId, now), this.#liveLimits(userId, now)]);
    return {
      selfExclusions: exclusions.map(shapeExclusion),
      limits: await Promise.all(limits.map((row) => this.#shapeLimit(row, now))),
    };
  }

  /** Step 1 — the fixed 24-hour cooldown. It is itself a break of `type`. */
  async startCooldown(userId, { type }) {
    const now = new Date();
    const until = new Date(now.getTime() + COOLDOWN_MS);
    const row = await this.models.PlayerSelfExclusion.create({
      user_id: userId,
      type,
      created_at: now,
      until_at: until,
      cooldown_until_at: until,
    });
    this.logger?.info({ userId: String(userId), type }, 'Self-exclusion cooldown started');
    return shapeExclusion(row.get({ plain: true }));
  }

  /**
   * Step 2 — the break itself, which only follows a cooldown. Any cooldown: the player site
   * widens step 2 to PLATFORM when a break is already running, so the types need not match.
   */
  async startBreak(userId, { type, breakPeriod }) {
    const cooled = await this.models.PlayerSelfExclusion.count({
      where: { user_id: userId, cooldown_until_at: { [Op.ne]: null } },
    });
    if (!cooled) throw errors.COOLDOWN_REQUIRED({ type });

    const now = new Date();
    const row = await this.models.PlayerSelfExclusion.create({
      user_id: userId,
      type,
      created_at: now,
      until_at: addSpan(now, BREAK_PERIODS[breakPeriod]),
      cooldown_until_at: null,
    });
    this.logger?.info({ userId: String(userId), type, breakPeriod }, 'Self-exclusion started');
    return shapeExclusion(row.get({ plain: true }));
  }

  async createLimit(userId, { type, usdAmount, periodUnit }) {
    const now = new Date();
    const live = await this.#liveLimits(userId, now);
    if (live.some((row) => row.type === type)) throw errors.LIMIT_EXISTS({ type });

    const row = await this.models.PlayerGamblingLimit.create({
      user_id: userId,
      type,
      usd_amount: money.toDecimalString(money.toMinor(String(usdAmount))),
      period_unit: periodUnit,
      created_at: now,
      expires_at: null,
    });
    this.logger?.info({ userId: String(userId), type, usdAmount, periodUnit }, 'Gambling limit set');
    return this.#shapeLimit(row.get({ plain: true }), now);
  }

  /** Removal is not immediate: the limit keeps applying for twelve more hours. */
  async requestLimitRemoval(userId, limitId) {
    const now = new Date();
    const row = (await this.#liveLimits(userId, now)).find((r) => String(r.id) === String(limitId));
    if (!row) throw errors.LIMIT_NOT_FOUND({ limitId });
    if (!row.expires_at) {
      const expiresAt = new Date(now.getTime() + LIMIT_REMOVAL_DELAY_MS);
      await this.models.PlayerGamblingLimit.update({ expires_at: expiresAt }, { where: { id: row.id, user_id: userId } });
      row.expires_at = expiresAt;
    }
    return this.#shapeLimit(row, now);
  }

  // ══ The stake check (wallet `debit`, reason BET_STAKE) ═══════════════

  /**
   * Refuse a stake the player's own rules forbid: a break covering it (PLATFORM covers both),
   * or a wager / loss limit this stake would go over. Two reads for a player with nothing set;
   * the ledger is only summed when a limit exists.
   */
  async assertMayStake({ userId, currency, amount, sports }) {
    const now = new Date();
    const covering = [EXCLUSION_TYPE.PLATFORM, sports ? EXCLUSION_TYPE.SPORTS : EXCLUSION_TYPE.CASINO];
    const [exclusions, limits] = await Promise.all([this.#activeExclusions(userId, now), this.#liveLimits(userId, now)]);

    const excluded = exclusions.find((row) => covering.includes(row.type));
    if (excluded) throw errors.SELF_EXCLUDED({ type: excluded.type, until: iso(excluded.until_at) });
    if (!limits.length) return;

    const stakeUsd = await this.rewardMoney.toUsd(String(amount), currency);
    if (stakeUsd == null) throw errors.NO_RATE({ currency });

    for (const limit of limits) {
      const since = windowStart(limit.created_at, limit.period_unit, now);
      const used = await this.#usage(userId, since);
      const usedUsd = limit.type === LIMIT_TYPE.WAGER_LIMIT ? used.wagered : used.lost;
      if (money.gt(dec(money.add(usedUsd, stakeUsd)), String(limit.usd_amount))) {
        const details = {
          type: limit.type,
          limitUsd: String(limit.usd_amount),
          usedUsd,
          stakeUsd,
          resetsAt: iso(windowEnd(since, limit.period_unit)),
        };
        throw limit.type === LIMIT_TYPE.WAGER_LIMIT ? errors.WAGER_LIMIT_REACHED(details) : errors.LOSS_LIMIT_REACHED(details);
      }
    }
  }

  // ══ Staff ═══════════════════════════════════════════════════════════

  /** One player's breaks and limits, past ones included — read-only (users:read, tree-scoped). */
  async forStaff(staff, userId) {
    await assertPlayerVisible(this.deps, staff?.id, userId);
    const now = new Date();
    const [exclusions, limits] = await Promise.all([
      this.models.PlayerSelfExclusion.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']], raw: true }),
      this.models.PlayerGamblingLimit.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']], raw: true }),
    ]);
    return {
      selfExclusions: exclusions.map((row) => ({ ...shapeExclusion(row), active: new Date(row.until_at) > now })),
      limits: await Promise.all(
        limits.map(async (row) => ({
          ...(await this.#shapeLimit(row, now)),
          active: !row.expires_at || new Date(row.expires_at) > now,
        }))
      ),
    };
  }

  // ══ Internals ═══════════════════════════════════════════════════════

  #activeExclusions(userId, now) {
    return this.models.PlayerSelfExclusion.findAll({
      where: { user_id: userId, until_at: { [Op.gt]: now } },
      order: [['until_at', 'DESC']],
      raw: true,
    });
  }

  #liveLimits(userId, now) {
    return this.models.PlayerGamblingLimit.findAll({
      where: { user_id: userId, [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: now } }] },
      order: [['created_at', 'DESC']],
      raw: true,
    });
  }

  /** A limit as the player site reads it, with the current window's use. */
  async #shapeLimit(row, now) {
    const since = windowStart(row.created_at, row.period_unit, now);
    const used = await this.#usage(row.user_id, since);
    return {
      id: String(row.id),
      type: row.type,
      usdAmount: String(row.usd_amount),
      periodUnit: row.period_unit,
      period: 1,
      progressAmount: row.type === LIMIT_TYPE.WAGER_LIMIT ? used.wagered : used.lost,
      createdAt: iso(row.created_at),
      expiredAt: iso(row.expires_at),
      resetsAt: iso(windowEnd(since, row.period_unit)),
    };
  }

  /** What the player staked and lost since `since`, in USD (`lib/betUsage`). */
  #usage(userId, since) {
    return betUsage({ db: this.db, toUsd: this.rewardMoney.toUsd }, { userId, since });
  }
}

/**
 * Sign-in refused during a PLATFORM break (auth `#assertUsable`: login, refresh, Google). Used
 * outside this module, so it takes the models rather than a service.
 */
async function assertNotPlatformExcluded(models, userId) {
  if (!models.PlayerSelfExclusion) return;
  const row = await models.PlayerSelfExclusion.findOne({
    where: { user_id: userId, type: EXCLUSION_TYPE.PLATFORM, until_at: { [Op.gt]: new Date() } },
    order: [['until_at', 'DESC']],
    raw: true,
  });
  if (row) throw errors.SELF_EXCLUDED({ type: row.type, until: iso(row.until_at) });
}

module.exports = { ResponsibleService, assertNotPlatformExcluded, windowStart, windowEnd, addSpan };
