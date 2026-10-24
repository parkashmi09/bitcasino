'use strict';

const { money, entitlements } = require('@ibitplay/common');
const { promotionsBlocked } = require('@ibitplay/auth');

const { WalletService } = require('../wallet/wallet.service');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { CODE_SOURCE, CODE_STATUS } = require('./spinWheel.constants');
const { SOURCE: BONUS_SOURCE } = require('../player-bonuses/playerBonus.constants');

const REF_TYPE = 'SPIN_WHEEL_BONUS';
/** One deposit, at most one spin bonus: the ledger's idempotency key is unique. */
const keyFor = (source, refId) => `spin-wheel-bonus:${source}:${refId}`;
/** Default cap (reward currency) when the config row predates migration 075. */
const DEFAULT_MAX_BONUS = '100';

/**
 * The spin wheel's code, applied to the player's NEXT credited deposit.
 *
 * The player types nothing. Every deposit path (fiat approval, the crypto webhook, PSP
 * callbacks) calls `FirstDepositBonusService.onDepositCredited` after its own commit; that hook
 * asks this service for a quote and decides between it and the first-deposit bonus (only the
 * larger is paid, see there). Like the first-deposit bonus it runs after the deposit's commit,
 * so a bonus that fails is logged and never turns the deposit into a failure.
 *
 *   deposit (any currency) ──rewardMoney.toReward──► reward currency
 *   bonus = min(deposit × code.bonus_pct / 100, spin_wheel_config.max_bonus)
 *
 * Granted like the first-deposit bonus, through `../player-bonuses`: to the locked BONUS BALANCE
 * with required wagering = bonus × `spin_wheel_config.wager_multiplier` (null = the first-deposit
 * multiplier), living `bonus_expiry_days` (migration 076); straight to cash when the owner's
 * `bonus.wagering_lock` is off or there is no multiplier.
 *
 * Exactly once: the code row is locked and must still be `active`; the credit (key
 * `spin-wheel-bonus:<source>:<refId>`) and the code's flip to `used` with `applied_ref` (unique,
 * migration 075) commit in one transaction. An expired, used or superseded code is never applied,
 * nor is any code for an agent-tree player.
 */
class SpinWheelBonusService {
  constructor(deps) {
    const { models, db, logger } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.wallet = deps.walletService ?? new WalletService(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    /** The owner's spin-wheel options: which deposits a won code may be applied to. */
    this.options = deps.spinWheelOptions ?? (() => entitlements.featureOptions('spin_wheel'));
    this.deps = deps;
  }

  /** The bonus balance (`../player-bonuses`), built on first use. */
  #bonuses() {
    if (this.deps.playerBonuses) return this.deps.playerBonuses;
    if (!this.playerBonuses) {
      const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
      this.playerBonuses = new PlayerBonusService({ ...this.deps, walletService: this.wallet, rewardMoney: this.rewardMoney });
    }
    return this.playerBonuses;
  }

  /** The spin bonus's wagering terms: its own multiplier (else `fallback`) and expiry days. */
  async terms(fallbackMultiplier = null) {
    const row = await this.models.SpinWheelConfig.findOne({ order: [['id', 'ASC']], raw: true });
    const own = row?.wager_multiplier;
    return {
      wagerMultiplier: own != null ? Number(own) : fallbackMultiplier,
      expiryDays: row?.bonus_expiry_days != null ? Number(row.bonus_expiry_days) : null,
    };
  }

  /** The player's active spin code, or null. */
  async activeCode(userId) {
    return this.models.Redeembonus.findOne({
      where: { userid: userId, source: CODE_SOURCE, status: CODE_STATUS.ACTIVE },
      order: [['createdat', 'DESC']],
      raw: true,
    });
  }

  /** The per-deposit cap, in the reward currency. */
  async maxBonus() {
    const row = await this.models.SpinWheelConfig.findOne({ order: [['id', 'ASC']], raw: true });
    return money.toDecimalString(money.toMinor(row?.max_bonus ?? DEFAULT_MAX_BONUS));
  }

  /**
   * What the player's active code would pay on this deposit, without paying it.
   * `{ ok: false, reason }` or `{ ok: true, codeId, pct, amount, currency, depositValue, capped }`.
   *
   * `isFirstDeposit`: the owner decides whether a code may go on the player's first deposit
   * (`bonus_on_first_deposit`) and on later ones (`bonus_on_later_deposits`). A deposit the owner
   * excludes leaves the code active for the next one.
   */
  async quote({ userId, currency, amount }, { isFirstDeposit = false } = {}) {
    if (!userId || !currency || !money.gt(amount ?? '0', '0')) return { ok: false, reason: 'NO_DEPOSIT' };

    const code = await this.activeCode(userId);
    if (!code) return { ok: false, reason: 'NO_ACTIVE_CODE' };

    const options = await this.options();
    if (isFirstDeposit && !options.bonus_on_first_deposit) return { ok: false, reason: 'NOT_ON_FIRST_DEPOSIT' };
    if (!isFirstDeposit && !options.bonus_on_later_deposits) return { ok: false, reason: 'NOT_ON_LATER_DEPOSITS' };
    if (!(Number(code.bonus_pct) > 0)) return { ok: false, reason: 'NO_PERCENTAGE' };

    if (await promotionsBlocked(userId)) return { ok: false, reason: 'AGENT_TREE_PLAYER' };

    const from = String(currency).toUpperCase();
    const deposited = money.toDecimalString(money.toMinor(amount));
    const priced = await this.rewardMoney.toReward(deposited, from);
    if (!priced) {
      this.logger?.warn({ from }, 'Spin wheel bonus: no exchange rate for the deposit currency');
      return { ok: false, reason: 'NO_EXCHANGE_RATE' };
    }

    const pct = String(code.bonus_pct);
    const cap = await this.maxBonus();
    const raw = money.percentOf(priced.amount, pct);
    const capped = money.gt(cap, '0') && money.gt(raw, cap);
    const bonus = money.toDecimalString(capped ? money.toMinor(cap) : raw);
    if (!money.gt(bonus, '0')) return { ok: false, reason: 'ZERO_BONUS' };

    return {
      ok: true,
      codeId: code.id,
      pct,
      amount: bonus,
      currency: priced.currency,
      depositValue: priced.amount,
      deposited,
      depositCurrency: from,
      capped,
    };
  }

  /** Pay a quote: credit the bonus and mark the code used, together. */
  async pay(quote, { userId, source, refId, wagerMultiplier = null }) {
    const appliedRef = `${source}:${refId}`;

    return this.db.transaction(async (transaction) => {
      const code = await this.models.Redeembonus.findOne({
        where: { id: quote.codeId },
        lock: transaction.LOCK.UPDATE,
        transaction,
        raw: true,
      });
      if (!code || code.status !== CODE_STATUS.ACTIVE || String(code.userid) !== String(userId)) {
        return { paid: false, reason: 'CODE_NOT_ACTIVE' };
      }

      const terms = await this.terms(wagerMultiplier);
      const rollover = terms.wagerMultiplier ? `, wager ${terms.wagerMultiplier}x` : '';
      const grant = await this.#bonuses().grant(
        {
          userId,
          source: BONUS_SOURCE.SPIN_WHEEL,
          grantKey: keyFor(source, refId),
          ref: appliedRef,
          amount: quote.amount,
          currency: quote.currency,
          wagerMultiplier: terms.wagerMultiplier,
          expiryDays: terms.expiryDays,
          description:
            `Spin wheel bonus: ${money.format(quote.pct)}% of ${money.format(quote.depositValue)} ${quote.currency}` +
            (quote.depositCurrency === quote.currency ? '' : ` (${money.format(quote.deposited)} ${quote.depositCurrency})`) +
            (quote.capped ? ', capped' : '') +
            rollover,
        },
        { transaction }
      );
      if (!grant.paid) return { paid: false, reason: grant.reason ?? 'ALREADY_PAID' };

      await this.models.Redeembonus.update(
        { status: CODE_STATUS.USED, applied_ref: appliedRef, applied_at: new Date(), updatedat: new Date() },
        { where: { id: code.id, status: CODE_STATUS.ACTIVE }, transaction }
      );

      return {
        paid: true,
        amount: quote.amount,
        currency: quote.currency,
        pct: quote.pct,
        capped: quote.capped,
        locked: grant.locked === true,
        bonusId: grant.bonusId,
        requiredWager: grant.requiredWager,
        expiresAt: grant.expiresAt ?? null,
        ledgerId: grant.ledgerId,
      };
    });
  }
}

module.exports = { SpinWheelBonusService, REF_TYPE, keyFor, DEFAULT_MAX_BONUS };
