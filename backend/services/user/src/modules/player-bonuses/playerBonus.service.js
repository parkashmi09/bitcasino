'use strict';

const { Op } = require('sequelize');
const { money, entitlements, wagerCategory, operatorSettings } = require('@ibitplay/common');
const { promotionsBlocked } = require('@ibitplay/auth');

const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { notifyPlayer, notifyBonus } = require('../notifications/notifyPlayer');
const { ownerWhere, assertPlayerVisible, withChannel } = require('../directory/playerScope');
const errors = require('./playerBonus.errors');
const { settleItem } = require('../wager/stakeShare');
const {
  STATUS, refTypeOf, labelOf, releaseKey, END_REASON, DEFAULT_EXPIRY_DAYS, UNLOCK_MODE, DEFAULT_UNLOCK_RATE,
} = require('./playerBonus.constants');
const { contributionFor } = require('./wagerContribution');

/** A stored decimal (any scale) as a canonical 8-place string. */
const D = (value) => money.fromStored(String(value ?? '0'));
const ZERO = '0.00000000';

/**
 * The bonus balance and its wagering lock.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DESIGN (migration 076)
 *
 * STORAGE. One `player_bonuses` row per granted bonus, in the currency it was granted in (the
 * reward currency at that moment). The BONUS BALANCE is the sum of a player's `active` rows per
 * currency — there is no second stored total to drift from them.
 *
 * SPEND ORDER: LOCKED UNTIL WAGERED. Bonus money is not in the cash wallet, so the casino and
 * sports debit paths (which only ever debit `credits`) cannot spend it, and neither can a
 * withdrawal, a swap or a vault deposit. The player bets with cash; every counted stake moves
 * their active bonuses toward `required_wager` (= amount × the source's multiplier), oldest
 * first, the remainder spilling to the next. When a bonus's requirement is met its amount is
 * credited to cash (a `BONUS` ledger row, key `player-bonus:<id>`) and the row becomes
 * `completed`, in one transaction. Wiring a bonus wallet into every provider's debit/credit
 * callback (in-house, js-games, GIS, x-casino, seamless, aggregators, the sportsbook) would have
 * touched every settlement path for one feature; this keeps them unchanged.
 *
 * REFUNDS. A stake refunded or rolled back (`wagerActivity.reverse`) takes its contribution back
 * out of every still-active bonus it moved (`player_bonus_wagers`). A bonus that already
 * completed keeps its cash — the same rule as VIP credits: nothing paid is clawed back.
 *
 * WITHDRAWALS. Cash only, always (the bonus is not cash). A withdrawal while a bonus is active is
 * refused with `BONUS_FORFEIT_REQUIRED` unless the player confirms (`forfeitBonus: true`); then
 * every active bonus is forfeited in the withdrawal's own transaction. A rejected withdrawal
 * returns the cash; the forfeit stands.
 *
 * EXPIRY. An active bonus past `expires_at` becomes `expired` — by the worker job every 10 min,
 * and lazily before every read, stake and withdrawal check.
 *
 * OWNER SWITCH. `options.bonus.wagering_lock` (owner panel, default ON). OFF: a grant is credited
 * to cash at once, as before, and recorded `completed` (end reason `WAGERING_LOCK_OFF`) so the
 * report still lists it. A bonus with no multiplier (0 / unset) is cash at once too.
 *
 * Agent-tree players never get a bonus (checked by the callers, and again here).
 * ═════════════════════════════════════════════════════════════════════════
 */
class PlayerBonusService {
  constructor(deps) {
    const { models, db, logger } = deps;
    this.deps = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.wallet = deps.walletService ?? new WalletService(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    /** The owner's switch. Fails open to the default (ON). */
    this.lockOption =
      deps.bonusWageringLock ??
      (async () => (await entitlements.featureOptions('bonus'))?.wagering_lock !== false);
    /** The Super Admin's bonus settings (site admin → Limits and policy → Bonus). */
    this.settings = deps.operatorSettings ?? operatorSettings(deps);
  }

  /** The owner's switch AND the Super Admin's `bonus_wagering_lock`: both on = locked. */
  async lockOn() {
    try {
      if ((await this.lockOption()) === false) return false;
      return String(await this.settings.read('bonus_wagering_lock', true)) !== 'false';
    } catch (error) {
      this.logger?.warn({ err: error }, 'Bonus wagering lock option unreadable — lock stays on');
      return true;
    }
  }

  /**
   * The Super Admin's forfeit rule and popup copy. `allowed` false: a locked bonus must be wagered
   * before any withdrawal (403 BONUS_WAGER_REQUIRED), and `forfeitBonus: true` cannot skip it.
   * Unreadable = the old behaviour (allowed, the default copy).
   */
  async forfeitPolicy() {
    try {
      const [allowed, title, message] = await Promise.all([
        this.settings.read('bonus_forfeit_allowed', true),
        this.settings.read('bonus_forfeit_title', null),
        this.settings.read('bonus_forfeit_message', null),
      ]);
      return { allowed: String(allowed) !== 'false', title, message };
    } catch (error) {
      this.logger?.warn({ err: error }, 'Bonus forfeit settings unreadable — forfeit stays allowed');
      return { allowed: true, title: null, message: null };
    }
  }

  /** `amount` of `from` in `to`; null when there is no rate. */
  async #convert(amount, from, to) {
    const a = String(from ?? '').toUpperCase();
    const b = String(to ?? '').toUpperCase();
    if (a === b) return D(amount);
    if (typeof this.rewardMoney.convert !== 'function') return null;
    try {
      return await this.rewardMoney.convert(amount, a, b);
    } catch (error) {
      this.logger?.warn({ err: error, from: a, to: b }, 'Bonus wagering: conversion failed');
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Grant
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Grant one bonus. With the lock on and a multiplier above zero it goes to the bonus balance;
   * otherwise it is credited to cash at once (and recorded `completed`).
   *
   * Exactly once per `grantKey` (unique on `player_bonuses`, and the cash credit's idempotency
   * key). Runs inside `transaction` when given (the spin code flips in the same one).
   *
   * @returns {{ paid, locked?, reason?, bonusId?, amount, currency, requiredWager?, expiresAt?, ledgerId? }}
   */
  async grant(input, { transaction } = {}) {
    const run = (fn) => (transaction ? fn(transaction) : this.db.transaction(fn));
    const {
      userId, source, grantKey, ref = null, currency, wagerMultiplier, expiryDays, description = null,
      unlockMode = UNLOCK_MODE.ROLLOVER, unlockRate = null,
    } = input;
    const gradual = unlockMode === UNLOCK_MODE.GRADUAL;
    const amount = D(input.amount);
    const code = String(currency).toUpperCase();
    if (!money.gt(amount, '0')) return { paid: false, reason: 'ZERO_BONUS' };

    if (await promotionsBlocked(userId)) return { paid: false, reason: 'AGENT_TREE_PLAYER' };

    const multiplier = gradual ? 0 : Number(wagerMultiplier) > 0 ? Number(wagerMultiplier) : 0;
    /* Gradual (hash.game): the "requirement" is the bonus itself — `wagered` counts what has
       UNLOCKED, `wager × contribution × house edge × unlock rate` per bet. */
    const requiredWager = gradual ? amount : money.toDecimalString(money.multiply(amount, String(multiplier)));
    const lock = await this.lockOn();
    const now = new Date();

    if (!lock || (!gradual && multiplier === 0)) {
      return run(async (t) => {
        if (await this.#alreadyGranted(grantKey, t)) return { paid: false, reason: 'ALREADY_PAID' };
        const movement = await this.wallet.credit(
          {
            userId,
            currency: code,
            amount,
            reason: REASON.BONUS,
            idempotencyKey: grantKey,
            refType: refTypeOf(source),
            refId: ref ?? grantKey,
            description: description ?? labelOf(source),
          },
          { sourceService: 'user-service', transaction: t }
        );
        if (movement.replayed) return { paid: false, reason: 'ALREADY_PAID' };
        const id = await this.#insert(
          {
            user_id: userId, source, grant_key: grantKey, ref, amount, currency: code,
            wager_multiplier: String(multiplier), required_wager: requiredWager, wagered: ZERO,
            status: STATUS.COMPLETED, expires_at: null, granted_at: now, completed_at: now, ended_at: now,
            end_reason: lock ? END_REASON.NO_WAGERING : END_REASON.LOCK_OFF,
            release_ledger_id: movement.ledgerId ?? null, description,
          },
          t
        );
        return { paid: true, locked: false, bonusId: id, amount, currency: code, requiredWager, ledgerId: movement.ledgerId };
      });
    }

    // hash.game: a gradual bonus has "no expiration".
    const days = gradual ? 0 : Number.isFinite(Number(expiryDays)) ? Number(expiryDays) : DEFAULT_EXPIRY_DAYS;
    const expiresAt = days > 0 ? new Date(now.getTime() + days * 86_400_000) : null;

    return run(async (t) => {
      if (await this.#alreadyGranted(grantKey, t)) return { paid: false, reason: 'ALREADY_PAID' };
      const id = await this.#insert(
        {
          user_id: userId, source, grant_key: grantKey, ref, amount, currency: code,
          wager_multiplier: String(multiplier), required_wager: requiredWager, wagered: ZERO,
          status: STATUS.ACTIVE, expires_at: expiresAt, granted_at: now, completed_at: null, ended_at: null,
          end_reason: null, release_ledger_id: null, description,
          unlock_mode: gradual ? UNLOCK_MODE.GRADUAL : UNLOCK_MODE.ROLLOVER,
          unlock_rate: gradual ? String(unlockRate ?? DEFAULT_UNLOCK_RATE) : null,
        },
        t
      );
      if (!id) return { paid: false, reason: 'ALREADY_PAID' };
      return {
        paid: true, locked: true, bonusId: id, amount, currency: code, requiredWager,
        unlockMode: gradual ? UNLOCK_MODE.GRADUAL : UNLOCK_MODE.ROLLOVER,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      };
    });
  }

  /** A row for this key, or a cash credit made under it before the lock existed. */
  async #alreadyGranted(grantKey, transaction) {
    const row = await this.models.PlayerBonus.findOne({ where: { grant_key: grantKey }, attributes: ['id'], transaction, raw: true });
    if (row) return true;
    const paid = await this.models.CreditsLedger.findOne({
      where: { idempotency_key: grantKey }, attributes: ['id'], transaction, raw: true,
    });
    return Boolean(paid);
  }

  /** INSERT … ON CONFLICT DO NOTHING: a duplicate must not abort the caller's transaction. */
  async #insert(row, transaction) {
    const columns = Object.keys(row);
    const rows = await this.db.sequelize.query(
      `INSERT INTO player_bonuses (${columns.join(', ')})
            VALUES (${columns.map((c) => `:${c}`).join(', ')})
       ON CONFLICT (grant_key) DO NOTHING
       RETURNING id`,
      { replacements: row, transaction, type: this.db.sequelize.QueryTypes.SELECT }
    );
    return rows?.[0]?.id != null ? String(rows[0].id) : null;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Wagering progress
  // ══════════════════════════════════════════════════════════════════════

  /**
   * One counted stake moves the player's active bonuses, oldest first. Idempotent per
   * `(bonus, source, ref)`. Called by `wagerActivity.record` after the stake is counted.
   *
   * @returns {{ applied: [{ bonusId, amount }], released: [bonusId] }}
   */
  async onStake({ userId, amount, currency, source, ref, kind = {} }) {
    const stakeCode = String(currency ?? '').toUpperCase();
    let remaining = D(amount);
    const key = String(ref);
    const out = { applied: [], released: [] };
    if (!money.gt(remaining, '0')) return out;

    const any = await this.models.PlayerBonus.findOne({
      where: { user_id: userId, status: STATUS.ACTIVE }, attributes: ['id'], raw: true,
    });
    if (!any) return out;

    const releasedRows = [];
    await this.db.transaction(async (transaction) => {
      const bonuses = await this.#lockActive(userId, transaction);
      const now = Date.now();
      for (const b of bonuses) {
        if (!money.gt(remaining, '0')) break;
        if (b.expires_at && new Date(b.expires_at).getTime() <= now) {
          await this.#end(b.id, STATUS.EXPIRED, END_REASON.EXPIRED, null, transaction);
          continue;
        }
        const seen = await this.models.PlayerBonusWager.findOne({
          where: { bonus_id: b.id, source, ref: key }, attributes: ['id'], transaction, raw: true,
        });
        if (seen) continue;

        const required = D(b.required_wager);
        const wagered = D(b.wagered);
        const need = money.toDecimalString(money.subtract(required, wagered));
        if (!money.gt(need, '0')) {
          releasedRows.push(await this.#release(b, transaction));
          continue;
        }

        const converted = await this.#convert(remaining, stakeCode, b.currency);
        if (converted == null || !money.gt(converted, '0')) {
          this.logger?.warn({ userId: String(userId), from: stakeCode, to: b.currency }, 'Bonus wagering: no rate — stake not counted for this bonus');
          continue;
        }
        /* Gradual (hash.game): what this stake can unlock is `stake × contribution × house edge ×
           unlock rate`; the rollover rule counts the stake itself. `inBonus` is that figure, in
           the bonus currency, and the share of the stake it used is worked out from it below. */
        const inBonus = b.unlock_mode === UNLOCK_MODE.GRADUAL ? await this.#unlockable(converted, b, kind) : converted;
        if (!money.gt(inBonus, '0')) continue;
        const take = money.toDecimalString(money.min(inBonus, need));
        // What is left of the stake, in the stake's own unit.
        if (money.gte(take, inBonus)) remaining = ZERO;
        else if (stakeCode === String(b.currency).toUpperCase() && b.unlock_mode !== UNLOCK_MODE.GRADUAL) remaining = money.toDecimalString(money.subtract(remaining, take));
        else {
          const share = money.toDecimalString(money.divide(money.toDecimalString(money.subtract(inBonus, take)), inBonus));
          remaining = money.toDecimalString(money.multiply(remaining, share));
        }

        await this.models.PlayerBonusWager.create(
          { bonus_id: b.id, user_id: userId, source, ref: key, amount: take },
          { transaction }
        );
        const after = money.toDecimalString(money.add(wagered, take));
        await this.models.PlayerBonus.update({ wagered: after }, { where: { id: b.id }, transaction });
        out.applied.push({ bonusId: String(b.id), amount: take });

        if (money.gte(after, required)) releasedRows.push(await this.#release({ ...b, wagered: after }, transaction));
      }
    });

    for (const r of releasedRows) {
      out.released.push(String(r.id));
      void notifyPlayer(r.user_id, {
        kind: 'bonus_unlocked',
        key: `bonus:unlocked:${r.id}`,
        title: 'Bonus unlocked',
        body: '{amount} bonus has been moved to your cash balance.',
        link: '/wallet',
        meta: { amount: D(r.amount), currency: r.currency },
      });
    }
    if (out.applied.length) this.logger?.info({ userId: String(userId), source, ref: key, ...out }, 'Bonus wagering counted');
    return out;
  }

  /**
   * A refunded / rolled-back stake stops counting toward every still-active bonus it moved.
   * A bonus that already completed keeps its cash. Idempotent.
   *
   * Partial refunds (migration 090): `reversedAmount` of `stake` (the stake's cumulative
   * refunded figure, in its own currency) pro-rates each allocation — `amount` keeps what
   * still counts, `reversed_amount` what was taken out, and the bonus's `wagered` drops by
   * the same cut. Each allocation is set to its exact target (`../wager/stakeShare`), so a
   * retry, a late side effect or a stale figure never takes anything out twice. Without the
   * figures (or once `full`) the whole allocation comes out and is stamped `reversed_at`.
   */
  async onReverse({ userId, source, ref, reversedAmount = null, stake = null, full = null }) {
    const key = String(ref);
    const whole = full ?? (reversedAmount == null || stake == null);
    const pending = await this.models.PlayerBonusWager.findAll({
      where: { user_id: userId, source, ref: key, reversed_at: null }, attributes: ['id'], raw: true,
    });
    if (!pending.length) return { reversed: [] };

    const reversed = [];
    await this.db.transaction(async (transaction) => {
      const allocs = await this.models.PlayerBonusWager.findAll({
        where: { user_id: userId, source, ref: key, reversed_at: null },
        order: [['bonus_id', 'ASC']],
        transaction,
        raw: true,
      });
      if (!allocs.length) return;
      const bonuses = await this.models.PlayerBonus.findAll({
        where: { id: allocs.map((a) => a.bonus_id) },
        order: [['granted_at', 'ASC'], ['id', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction,
        raw: true,
      });
      const byId = new Map(bonuses.map((b) => [String(b.id), b]));
      for (const a of allocs) {
        // Re-read under the bonus lock: a concurrent reversal may have settled it already.
        const current = await this.models.PlayerBonusWager.findOne({
          where: { id: a.id, reversed_at: null }, transaction, lock: transaction.LOCK.UPDATE, raw: true,
        });
        if (!current) continue;
        const next = settleItem(current, { reversedStake: reversedAmount, stake, full: whole });
        if (!next && !whole) continue;
        const cut = next ? next.delta : ZERO;
        await this.models.PlayerBonusWager.update(
          {
            ...(next ? { amount: next.amount, reversed_amount: next.reversed } : {}),
            ...(whole ? { reversed_at: new Date() } : {}),
          },
          { where: { id: a.id, reversed_at: null }, transaction }
        );
        const b = byId.get(String(a.bonus_id));
        if (!b || b.status !== STATUS.ACTIVE || !money.gt(cut, '0')) continue;
        let after = money.toDecimalString(money.subtract(D(b.wagered), cut));
        if (money.lt(after, '0')) after = ZERO;
        await this.models.PlayerBonus.update({ wagered: after }, { where: { id: b.id }, transaction });
        b.wagered = after;
        reversed.push({ bonusId: String(b.id), amount: cut });
      }
    });
    if (reversed.length) this.logger?.info({ userId: String(userId), source, ref: key, reversed }, 'Bonus wagering reversed');
    return { reversed };
  }

  /** Active bonuses of a player, oldest first, locked. */
  /** What `stake` (already in the bonus currency) unlocks on a gradual bonus. */
  async #unlockable(stake, b, kind) {
    const contribution = await contributionFor(this.db.sequelize, kind, { logger: this.logger });
    const houseEdge = String(kind?.house_edge ?? wagerCategory.DEFAULT_HOUSE_EDGE[kind?.category] ?? wagerCategory.DEFAULT_HOUSE_EDGE.slots);
    const rate = String(b.unlock_rate ?? DEFAULT_UNLOCK_RATE);
    const value = money.multiply(money.toDecimalString(money.multiply(money.toDecimalString(money.multiply(stake, contribution)), houseEdge)), rate);
    return money.toDecimalString(value);
  }

  /**
   * hash.game: "Claim your unlocked rewards from the Bonus page anytime." Moves what has unlocked
   * on every active gradual bonus (unlocked − already claimed) to cash. Each claim is its own
   * ledger key (`player-bonus:<id>:claim:<claimed after>`), so a retry pays nothing twice.
   */
  async claimUnlocked(userId) {
    const paid = [];
    await this.db.transaction(async (transaction) => {
      const active = await this.#lockActive(userId, transaction);
      for (const b of active) {
        if (b.unlock_mode !== UNLOCK_MODE.GRADUAL) continue;
        const unlocked = D(b.wagered);
        const claimed = D(b.claimed_amount ?? '0');
        const due = money.toDecimalString(money.subtract(unlocked, claimed));
        if (!money.gt(due, '0')) continue;
        const after = money.toDecimalString(money.add(claimed, due));
        const movement = await this.wallet.credit(
          {
            userId,
            currency: b.currency,
            amount: due,
            reason: REASON.BONUS,
            idempotencyKey: `${releaseKey(b.id)}:claim:${after}`,
            refType: refTypeOf(b.source),
            refId: String(b.id),
            description: `${labelOf(b.source)}: unlocked part claimed`,
          },
          { sourceService: 'user-service', transaction }
        );
        await this.models.PlayerBonus.update({ claimed_amount: after }, { where: { id: b.id }, transaction });
        paid.push({ bonusId: String(b.id), amount: due, currency: b.currency, ledgerId: movement.ledgerId ?? null });
      }
    });
    if (!paid.length) throw errors.NOTHING_TO_CLAIM({ userId: String(userId) });
    this.logger?.info({ userId: String(userId), paid }, 'Unlocked bonus claimed');
    for (const p of paid) void notifyBonus(userId, { key: `bonus:claim-unlocked:${p.bonusId}:${p.ledgerId ?? Date.now()}`, title: 'Unlocked bonus claimed', amount: p.amount, currency: p.currency });
    return { claimed: paid };
  }

  async #lockActive(userId, transaction) {
    return this.models.PlayerBonus.findAll({
      where: { user_id: userId, status: STATUS.ACTIVE },
      order: [['granted_at', 'ASC'], ['id', 'ASC']],
      lock: transaction.LOCK.UPDATE,
      transaction,
      raw: true,
    });
  }

  /** Requirement met: the amount goes to cash, the row is completed — inside `transaction`. */
  async #release(b, transaction) {
    // A gradual bonus may have been claimed in parts already; the rest goes now.
    const amount = money.toDecimalString(money.subtract(D(b.amount), D(b.claimed_amount ?? '0')));
    if (!money.gt(amount, '0')) {
      const now = new Date();
      await this.models.PlayerBonus.update(
        { status: STATUS.COMPLETED, completed_at: now, ended_at: now, end_reason: END_REASON.WAGERING_MET },
        { where: { id: b.id, status: STATUS.ACTIVE }, transaction }
      );
      return { ...b, status: STATUS.COMPLETED };
    }
    const movement = await this.wallet.credit(
      {
        userId: b.user_id,
        currency: b.currency,
        amount,
        reason: REASON.BONUS,
        idempotencyKey: releaseKey(b.id),
        refType: refTypeOf(b.source),
        refId: String(b.id),
        description: `${labelOf(b.source)} unlocked: ${money.format(D(b.required_wager))} ${b.currency} wagered`,
      },
      { sourceService: 'user-service', transaction }
    );
    const now = new Date();
    await this.models.PlayerBonus.update(
      {
        status: STATUS.COMPLETED, completed_at: now, ended_at: now, end_reason: END_REASON.WAGERING_MET,
        release_ledger_id: movement.ledgerId ?? null, claimed_amount: D(b.amount),
      },
      { where: { id: b.id, status: STATUS.ACTIVE }, transaction }
    );
    this.logger?.info({ userId: String(b.user_id), bonusId: String(b.id), amount, currency: b.currency }, 'Bonus wagering met — released to cash');
    return { ...b, status: STATUS.COMPLETED };
  }

  async #end(id, status, reason, staffId, transaction) {
    const [count] = await this.models.PlayerBonus.update(
      { status, ended_at: new Date(), end_reason: reason, ended_by: staffId ?? null },
      { where: { id, status: STATUS.ACTIVE }, transaction }
    );
    return count > 0;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Expiry, forfeit, withdrawal
  // ══════════════════════════════════════════════════════════════════════

  /** Active bonuses past their expiry → `expired`. One player, or everyone (the job). */
  async expireDue({ userId } = {}) {
    const where = { status: STATUS.ACTIVE, expires_at: { [Op.lte]: new Date() } };
    if (userId != null) where.user_id = userId;
    const [count] = await this.models.PlayerBonus.update(
      { status: STATUS.EXPIRED, ended_at: new Date(), end_reason: END_REASON.EXPIRED },
      { where }
    );
    if (count) this.logger?.info({ userId: userId == null ? undefined : String(userId), count }, 'Bonuses expired');
    return count;
  }

  /**
   * Before a withdrawal debits cash. No active bonus: nothing. Active bonuses and no
   * `forfeitBonus`: `BONUS_FORFEIT_REQUIRED`. Confirmed: they are forfeited inside
   * `transaction` (call it before the debit, so the lock order is bonuses → wallet, as in
   * `onStake`; a debit that fails rolls the forfeit back with it).
   */
  async beforeWithdrawal(userId, { forfeitBonus = false, transaction } = {}) {
    await this.expireDue({ userId });
    const check = async (t) => {
      /* A gradual bonus never blocks a withdrawal (hash.game: "All rewards are real cash and can
         be withdrawn immediately") — its locked part just stays locked. Only rollover bonuses do. */
      const active = (
        t
          ? await this.#lockActive(userId, t)
          : await this.models.PlayerBonus.findAll({ where: { user_id: userId, status: STATUS.ACTIVE }, raw: true })
      ).filter((b) => b.unlock_mode !== UNLOCK_MODE.GRADUAL);
      if (!active.length) return { forfeited: [] };
      const policy = await this.forfeitPolicy();
      const details = {
        count: active.length,
        bonuses: active.map((b) => ({
          id: String(b.id),
          amount: D(b.amount),
          currency: b.currency,
          remaining: remainingOf(b),
        })),
      };
      // Checked on the confirmed resend too: the popup is not the only way to send `forfeitBonus`.
      if (!policy.allowed) throw errors.WAGER_REQUIRED(details);
      if (!forfeitBonus) throw errors.FORFEIT_REQUIRED({ ...details, title: policy.title, message: policy.message });
      if (!t) return { forfeited: [], pending: active.length };
      for (const b of active) await this.#end(b.id, STATUS.FORFEITED, END_REASON.WITHDRAWAL, null, t);
      this.logger?.info({ userId: String(userId), bonuses: active.map((b) => String(b.id)) }, 'Active bonuses forfeited by a withdrawal');
      return { forfeited: active.map((b) => String(b.id)) };
    };
    return check(transaction);
  }

  /**
   * For a withdrawal path whose debit is not in a transaction this service can join (PSP
   * payouts): `beforeWithdrawal` without a transaction only checks; this forfeits, after the
   * debit succeeded.
   */
  async forfeitForWithdrawal(userId) {
    return this.db.transaction(async (transaction) => {
      const active = (await this.#lockActive(userId, transaction)).filter((b) => b.unlock_mode !== UNLOCK_MODE.GRADUAL);
      for (const b of active) await this.#end(b.id, STATUS.FORFEITED, END_REASON.WITHDRAWAL, null, transaction);
      if (active.length) this.logger?.info({ userId: String(userId), bonuses: active.map((b) => String(b.id)) }, 'Active bonuses forfeited by a withdrawal');
      return { forfeited: active.map((b) => String(b.id)) };
    });
  }

  /**
   * The player's active bonuses with their wagering still open, for the withdrawal
   * requirements (`../withdraw-requirements`). Expires due ones first, as every read does.
   * A bonus with nothing left to wager is not listed (it is released on the next stake).
   */
  async openWagering(userId) {
    await this.expireDue({ userId });
    const active = await this.models.PlayerBonus.findAll({
      where: { user_id: userId, status: STATUS.ACTIVE },
      order: [['granted_at', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    return active
      .filter((b) => b.unlock_mode !== UNLOCK_MODE.GRADUAL)
      .map((b) => ({
        id: String(b.id),
        source: b.source,
        currency: b.currency,
        amount: D(b.amount),
        requiredWager: D(b.required_wager),
        wagered: D(b.wagered),
        remaining: remainingOf(b),
      }))
      .filter((b) => money.gt(b.remaining, '0'));
  }

  /** A staff forfeit of one bonus (the route writes the audit row). */
  async forfeit({ bonusId, staff, reason }) {
    const row = await this.models.PlayerBonus.findByPk(bonusId, { raw: true });
    if (!row) throw errors.NOT_FOUND({ bonusId: String(bonusId) });
    if (staff) await assertPlayerVisible(this.deps, staff.id, row.user_id);
    const ok = await this.db.transaction(async (transaction) => {
      await this.models.PlayerBonus.findOne({ where: { id: bonusId }, lock: transaction.LOCK.UPDATE, transaction, raw: true });
      return this.#end(bonusId, STATUS.FORFEITED, reason ? `${END_REASON.MANUAL}: ${String(reason).slice(0, 50)}` : END_REASON.MANUAL, staff?.id ?? null, transaction);
    });
    if (!ok) throw errors.NOT_ACTIVE({ bonusId: String(bonusId), status: row.status });
    this.logger?.warn({ bonusId: String(bonusId), userId: String(row.user_id), staffId: staff?.id }, 'Bonus forfeited by staff');
    return this.#shape(await this.models.PlayerBonus.findByPk(bonusId, { raw: true }), { staffView: true });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /** The player's own bonus balance — `GET /user/bonus-balance`. */
  async summary(userId) {
    await this.expireDue({ userId });
    const [active, history, lock, currency] = await Promise.all([
      this.models.PlayerBonus.findAll({
        where: { user_id: userId, status: STATUS.ACTIVE },
        order: [['granted_at', 'ASC'], ['id', 'ASC']],
        raw: true,
      }),
      this.models.PlayerBonus.findAll({
        where: { user_id: userId, status: { [Op.ne]: STATUS.ACTIVE } },
        order: [['granted_at', 'DESC'], ['id', 'DESC']],
        limit: 10,
        raw: true,
      }),
      this.lockOn(),
      this.rewardMoney.currency(),
    ]);
    const totals = new Map();
    // What is still held: a gradual bonus's claimed part is already cash (found on live: the
    // balance stayed 10.80 after claiming 9.69, so Total Balance counted it twice).
    for (const b of active) {
      const held = money.toDecimalString(money.subtract(D(b.amount), D(b.claimed_amount ?? '0')));
      totals.set(b.currency, money.toDecimalString(money.add(totals.get(b.currency) ?? '0', held)));
    }
    return {
      wageringLock: lock,
      currency,
      balances: [...totals].map(([code, amount]) => ({ currency: code, amount })),
      active: active.map((b) => this.#shape(b)),
      history: history.map((b) => this.#shape(b)),
    };
  }

  /** Staff: one player's bonuses (tree-scoped). */
  async listForPlayer({ staff, userId }) {
    await assertPlayerVisible(this.deps, staff?.id, userId);
    await this.expireDue({ userId });
    const rows = await this.models.PlayerBonus.findAll({
      where: { user_id: userId }, order: [['granted_at', 'DESC'], ['id', 'DESC']], limit: 200, raw: true,
    });
    return rows.map((b) => this.#shape(b, { staffView: true }));
  }

  /** Staff: the bonuses report (tree-scoped), with totals per status and currency. */
  async report({ staff, userId, status, source, from, to, channel, limit = 50, offset = 0 }) {
    const scope = await ownerWhere(this.deps, staff?.id, 'user_id', userId);
    const where = withChannel({ ...scope }, 'user_id', channel);
    if (status) where.status = status;
    if (source) where.source = source;
    if (from || to) {
      where.granted_at = {};
      if (from) where.granted_at[Op.gte] = new Date(from);
      if (to) where.granted_at[Op.lte] = new Date(to);
    }
    const { rows, count } = await this.models.PlayerBonus.findAndCountAll({
      where, order: [['granted_at', 'DESC'], ['id', 'DESC']], limit, offset, raw: true,
    });
    const sums = await this.models.PlayerBonus.findAll({
      where,
      attributes: [
        'status', 'currency',
        [this.db.sequelize.fn('COUNT', this.db.sequelize.col('id')), 'count'],
        [this.db.sequelize.fn('SUM', this.db.sequelize.col('amount')), 'amount'],
      ],
      group: ['status', 'currency'],
      raw: true,
    });
    const ids = [...new Set(rows.map((r) => Number(r.user_id)))];
    const users = ids.length
      ? await this.models.Users.findAll({ where: { id: ids }, attributes: ['id', 'name'], raw: true })
      : [];
    const nameOf = new Map(users.map((u) => [String(u.id), u.name]));
    return {
      rows: rows.map((b) => ({ ...this.#shape(b, { staffView: true }), userName: nameOf.get(String(b.user_id)) ?? null })),
      total: count,
      totals: sums.map((s) => ({ status: s.status, currency: s.currency, count: Number(s.count), amount: D(s.amount) })),
    };
  }

  #shape(b, { staffView = false } = {}) {
    const required = D(b.required_wager);
    const wagered = D(b.wagered);
    // Percent with two decimals, floored (99.999 is not 100 until it is).
    const progress = money.gt(required, '0')
      ? Math.min(100, Math.floor(Number(money.divide(money.multiply(wagered, '100'), required)) / 1e6) / 100)
      : 100;
    return {
      id: String(b.id),
      ...(staffView ? { userId: String(b.user_id) } : {}),
      source: b.source,
      amount: D(b.amount),
      currency: b.currency,
      wagerMultiplier: Number(b.wager_multiplier ?? 0),
      requiredWager: required,
      wagered,
      remaining: remainingOf(b),
      progress,
      status: b.status,
      // Gradual (hash.game): unlocked so far, already claimed, claimable now.
      unlockMode: b.unlock_mode ?? UNLOCK_MODE.ROLLOVER,
      ...(b.unlock_mode === UNLOCK_MODE.GRADUAL
        ? {
            unlocked: wagered,
            claimed: D(b.claimed_amount ?? '0'),
            claimable: money.toDecimalString(money.max('0', money.toDecimalString(money.subtract(wagered, D(b.claimed_amount ?? '0'))))),
            locked: money.toDecimalString(money.subtract(D(b.amount), wagered)),
          }
        : {}),
      ref: b.ref ?? null,
      grantedAt: iso(b.granted_at),
      expiresAt: iso(b.expires_at),
      completedAt: iso(b.completed_at),
      endedAt: iso(b.ended_at),
      endReason: b.end_reason ?? null,
      ...(staffView ? { endedBy: b.ended_by != null ? String(b.ended_by) : null } : {}),
    };
  }
}

function remainingOf(b) {
  const left = money.subtract(D(b.required_wager), D(b.wagered));
  return left > 0n ? money.toDecimalString(left) : ZERO;
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

module.exports = { PlayerBonusService };
