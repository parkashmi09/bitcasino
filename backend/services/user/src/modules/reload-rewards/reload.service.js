'use strict';

const { money } = require('@ibitplay/common');

const errors = require('./reload.errors');
const { PROGRAM, PRE_MONTHLY_OPENS_DAY, REASON } = require('./reload.constants');
const { WalletService } = require('../wallet/wallet.service');
const { VipService } = require('../vip/vip.service');
const { notifyBonus } = require('../notifications/notifyPlayer');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { betUsage } = require('../../lib/betUsage');

const DAY_MS = 24 * 60 * 60 * 1000;
const dec = (minor) => money.toDecimalString(minor);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const dayKey = (d) => d.toISOString().slice(0, 10);

/**
 * The window a program measures and whether it is open, at `now`:
 *
 *   DAILY_RELOAD  yesterday 00:00–24:00 UTC; open all of today; claimed once per UTC day
 *   PRE_MONTHLY   the 1st 00:00 to the 15th 00:00 UTC; open from the 15th to the month's end
 */
function windowFor(program, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (program === PROGRAM.DAILY_RELOAD) {
    return { since: new Date(today.getTime() - DAY_MS), until: today, open: true, periodKey: dayKey(today), opensAt: null };
  }
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const opens = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), PRE_MONTHLY_OPENS_DAY));
  return { since: first, until: opens, open: now >= opens, periodKey: first.toISOString().slice(0, 7), opensAt: opens };
}

/**
 * The Rewards popup's Daily Reload and Pre-Monthly Bonus (rainbet) — a share of what the player
 * wagered, at the site admin's rate, paid in the reward coin. See migration 165.
 */
class ReloadService {
  constructor(deps) {
    this.deps = deps;
    this.models = deps.models;
    this.db = deps.db;
    this.logger = deps.logger;
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    this.wallet = deps.wallet ?? new WalletService(deps);
    this.vip = deps.vip ?? new VipService(deps);
  }

  /** Both programs for the player: what they would pay now, and whether it can be claimed. */
  async overview(userId) {
    const now = new Date();
    const [programs, standing] = await Promise.all([this.#programs(), this.vip.standing(userId)]);
    const level = Number(standing?.level ?? 0);
    const out = {};
    for (const key of Object.values(PROGRAM)) out[key] = await this.#state(programs.get(key), userId, level, now);
    return { vipLevel: level, ...out };
  }

  async claim(userId, program) {
    const now = new Date();
    const [programs, standing] = await Promise.all([this.#programs(), this.vip.standing(userId)]);
    const state = await this.#state(programs.get(program), userId, Number(standing?.level ?? 0), now);
    if (state.claimed) throw errors.ALREADY_CLAIMED({ program });
    if (!state.enabled || !state.open) throw errors.NOT_AVAILABLE({ program });
    if (!state.eligible) throw errors.VIP_REQUIRED({ program, minVipLevel: state.minVipLevel });
    if (!money.gt(state.amount, '0')) throw errors.NOTHING_TO_CLAIM({ program });

    // The row first: its unique key is what makes a double press claim once.
    let row;
    try {
      row = await this.models.ReloadClaim.create({
        program,
        user_id: userId,
        period_key: state.periodKey,
        wagered_usd: state.wageredUsd,
        amount_usd: state.amountUsd,
        currency: state.currency,
        amount: state.amount,
        created_at: now,
      });
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') throw errors.ALREADY_CLAIMED({ program });
      throw error;
    }

    let movement;
    try {
      movement = await this.wallet.credit(
        {
          userId,
          currency: state.currency,
          amount: state.amount,
          reason: REASON.RELOAD,
          idempotencyKey: `reload:${row.id}`,
          refType: 'RELOAD_BONUS',
          refId: String(row.id),
          description: program === PROGRAM.DAILY_RELOAD ? `Daily Reload ${state.periodKey}` : `Pre-Monthly Bonus ${state.periodKey}`,
        },
        { sourceService: 'user-service' }
      );
    } catch (error) {
      // Nothing was paid: free the period so the player can try again.
      await this.models.ReloadClaim.destroy({ where: { id: row.id } });
      throw error;
    }
    await this.models.ReloadClaim.update({ ledger_id: movement.ledgerId }, { where: { id: row.id } });
    void notifyBonus(userId, {
      key: `reload:${row.id}`,
      title: program === PROGRAM.DAILY_RELOAD ? 'Daily Reload claimed' : 'Pre-Monthly Bonus claimed',
      amount: state.amount,
      currency: state.currency,
      link: '/rewards',
    }).catch(() => {});
    return { program, periodKey: state.periodKey, currency: state.currency, amount: state.amount, balance: movement.newBalance };
  }

  // ══ Staff ═══════════════════════════════════════════════════════════

  async listPrograms() {
    const programs = await this.#programs();
    return Object.values(PROGRAM).map((key) => this.#shapeProgram(programs.get(key)));
  }

  async updateProgram(program, patch) {
    const fields = { updated_at: new Date() };
    if (patch.enabled !== undefined) fields.enabled = patch.enabled;
    if (patch.percent !== undefined) fields.percent = String(patch.percent);
    if (patch.minVipLevel !== undefined) fields.min_vip_level = patch.minVipLevel;
    const [count] = await this.models.ReloadProgram.update(fields, { where: { key: program } });
    if (!count) throw errors.PROGRAM_NOT_FOUND({ program });
    return this.#shapeProgram((await this.#programs()).get(program));
  }

  /** The newest claims with the player's name. */
  async listClaims({ limit = 50 } = {}) {
    const rows = await this.models.ReloadClaim.findAll({ order: [['id', 'DESC']], limit, raw: true });
    const users = rows.length
      ? await this.models.Users.findAll({ where: { id: [...new Set(rows.map((r) => String(r.user_id)))] }, attributes: ['id', 'name'], raw: true })
      : [];
    const names = new Map(users.map((u) => [String(u.id), u.name]));
    return rows.map((r) => ({
      id: String(r.id),
      program: r.program,
      userId: String(r.user_id),
      player: names.get(String(r.user_id)) ?? null,
      periodKey: r.period_key,
      wageredUsd: String(r.wagered_usd),
      amountUsd: String(r.amount_usd),
      currency: r.currency,
      amount: String(r.amount),
      createdAt: iso(r.created_at),
    }));
  }

  // ══ Internals ═══════════════════════════════════════════════════════

  async #programs() {
    const rows = await this.models.ReloadProgram.findAll({ raw: true });
    return new Map(rows.map((r) => [r.key, r]));
  }

  #shapeProgram(p) {
    return {
      program: p.key,
      enabled: Boolean(p.enabled),
      percent: String(p.percent),
      minVipLevel: Number(p.min_vip_level),
      updatedAt: iso(p.updated_at),
    };
  }

  /** One program for one player at `now`. */
  async #state(program, userId, level, now) {
    if (!program) return { enabled: false, open: false, claimable: false };
    const w = windowFor(program.key, now);
    const [used, claimed] = await Promise.all([
      betUsage({ db: this.db, toUsd: this.rewardMoney.toUsd }, { userId, since: w.since, until: w.until }),
      this.models.ReloadClaim.count({ where: { program: program.key, user_id: userId, period_key: w.periodKey } }),
    ]);
    const amountUsd = dec(money.divide(dec(money.multiply(used.wagered, String(program.percent))), 100));
    const payout = await this.rewardMoney.fromUsd(amountUsd);
    const eligible = level >= Number(program.min_vip_level);
    const enabled = Boolean(program.enabled);
    return {
      enabled,
      percent: String(program.percent),
      minVipLevel: Number(program.min_vip_level),
      eligible,
      open: w.open,
      opensAt: iso(w.opensAt),
      periodKey: w.periodKey,
      wageredUsd: used.wagered,
      amountUsd,
      currency: payout.currency,
      amount: payout.amount,
      claimed: claimed > 0,
      claimable: enabled && eligible && w.open && !claimed && money.gt(String(payout.amount), '0'),
    };
  }
}

module.exports = { ReloadService, windowFor };
