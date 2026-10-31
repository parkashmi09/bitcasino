'use strict';

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');
const { promotionsBlocked } = require('@ibitplay/auth');

const { WalletService } = require('../wallet/wallet.service');
const { REASON } = require('../wallet/wallet.constants');
const { createWelcomeBonusResolver, normaliseTiers } = require('./welcomeBonusSettings');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { notifyPlayer } = require('../notifications/notifyPlayer');
const { SpinWheelBonusService } = require('../spin-wheel/spinWheelBonus.service');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { SOURCE: BONUS_SOURCE } = require('../player-bonuses/playerBonus.constants');

const REF_TYPE = 'FIRST_DEPOSIT_BONUS';
const keyFor = (userId) => `first-deposit-bonus:${userId}`;
/** One monthly deposit bonus per (player, UTC month, deposit number). */
const monthlyKeyFor = (userId, { month, n }) => `monthly-deposit-bonus:${userId}:${month}:${n}`;

/**
 * ── REWARD CURRENCY (supersedes the USD wording below) ──────────────────
 *
 * The tiers are entered by the operator in the site's REWARD CURRENCY
 * (`rewardCurrency()`, chosen by the owner; USDT by default), and the bonus is
 * paid in it. The deposit is converted into that currency once
 * (`rewardMoney.toReward`) before the tier is chosen or the percent applied.
 * With the default reward currency this is exactly the USD model below.
 *
 * The first-deposit bonus: a TIERED match on a player's FIRST credited deposit,
 * everything in USD (BC.Game's "deposit bonus up to 180%" model).
 *
 *   deposit (any currency) ──exchangerate──► USD
 *   tier   = the highest tier whose minDeposit <= that USD amount
 *   bonus  = min(USD × tier.percent / 100, tier.maxBonus)   (maxBonus 0 = no cap)
 *   paid in REWARD_CURRENCY (USDT)
 *
 * ── CURRENCY ────────────────────────────────────────────────────────────
 *
 * The settings and the payout are both USD, and the deposit is converted
 * ONCE, through the exchange-rate module, before anything is compared or
 * multiplied. No INR figure is ever treated as dollars (the INR/USDT 88x
 * rakeback defect was exactly that). No rate for the deposit's currency → no
 * bonus (logged), never a guess.
 *
 * ── CALLED AFTER EVERY DEPOSIT CREDIT, ON EVERY PATH ────────────────────
 *
 * Fiat approval (fiat-deposit), the crypto webhook (crypto) and PSP callbacks
 * (psp — where payment-orders' deposits settle) each call `onDepositCredited`
 * AFTER their own transaction has committed. It never throws: the deposit is
 * already the player's money, and a bonus that fails is logged, not turned
 * into a failed deposit.
 *
 * ── "FIRST" ─────────────────────────────────────────────────────────────
 *
 * Every deposit path credits with `reason = DEPOSIT`, so the first deposit is
 * the player's EARLIEST `DEPOSIT` row in `credits_ledger`. Only the deposit
 * whose ledger row is that one qualifies — a later deposit never does, even if
 * the first one was below every tier or arrived while the bonus was off.
 * Approved `fiat_deposits` from before the ledger existed count too.
 *
 * ── EXACTLY ONCE ────────────────────────────────────────────────────────
 *
 * The credit's idempotency key is `first-deposit-bonus:<userId>`, and
 * `credits_ledger.idempotency_key` is UNIQUE with no time window. The wallet's
 * own replay lookup only spans 48 hours, so the key is also checked here
 * against the whole ledger before paying.
 *
 * ── WAGERING (migration 076) ────────────────────────────────────────────
 *
 * The bonus goes to the player's locked BONUS BALANCE (`../player-bonuses`), not
 * to cash: required wagering = bonus × `wagerMultiplier`, and it becomes cash
 * when that much has been staked, within `expiryDays` (else it is forfeited).
 * With the owner's `bonus.wagering_lock` OFF, or no multiplier, it is credited
 * to cash at once as before. "Exactly once" holds through the same key, now the
 * unique `player_bonuses.grant_key`.
 *
 * Agent-tree players are funded by their agent only and get nothing.
 */
class FirstDepositBonusService {
  constructor(deps) {
    const { models, logger } = deps;
    this.models = models;
    this.logger = logger;
    this.wallet = deps.walletService ?? new WalletService(deps);
    this.settings = deps.welcomeBonusSettings ?? createWelcomeBonusResolver(deps);
    this.rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
    this.playerBonuses = deps.playerBonuses ?? new PlayerBonusService({ ...deps, walletService: this.wallet, rewardMoney: this.rewardMoney });
    this.spinBonus = deps.spinWheelBonus ?? new SpinWheelBonusService({
      ...deps, walletService: this.wallet, rewardMoney: this.rewardMoney, playerBonuses: this.playerBonuses,
    });
    this.deps = deps;
  }

  /** The affiliate service, built on first use (it is not needed by every caller). */
  #affiliate() {
    if (this.deps.affiliate) return this.deps.affiliate;
    if (!this.affiliateService) {
      const { AffiliateService } = require('../affiliate/affiliate.service');
      this.affiliateService = new AffiliateService(this.deps);
    }
    return this.affiliateService;
  }

  async #terms() {
    const raw = await this.settings.firstDeposit();
    return {
      enabled: raw?.enabled === true,
      tiers: normaliseTiers(raw?.tiers),
      wagerMultiplier: raw?.wagerMultiplier ?? null,
      expiryDays: raw?.expiryDays ?? null,
      program: raw?.program ?? { mode: 'first', unlockMode: 'rollover', unlockRate: '0.01', schedule: [] },
    };
  }

  /** UTC month bounds and its `YYYY-MM` label — hash.game resets "on the 1st of each month at 00:00 UTC". */
  #month(now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, label: start.toISOString().slice(0, 7) };
  }

  /** How many monthly deposit bonuses this player has had this month. */
  async #monthlyUsed(userId) {
    const { start } = this.#month();
    return (
      (await this.models.PlayerBonus?.count({
        where: { user_id: userId, source: BONUS_SOURCE.MONTHLY_DEPOSIT, granted_at: { [Op.gte]: start } },
      })) ?? 0
    );
  }

  /**
   * What the player UI shows — `GET /user/bonus/first-deposit`.
   * Anonymous callers get the terms with `eligible: false`.
   */
  async overview({ userId = null } = {}) {
    const terms = await this.#terms();
    const enabled = terms.enabled && terms.tiers.length > 0;
    const base = {
      enabled,
      eligible: false,
      // The tiers' unit — the site's reward currency.
      currency: await this.rewardMoney.currency(),
      tiers: enabled
        ? terms.tiers.map((t) => ({
            minDeposit: twoPlaces(t.minDeposit),
            percent: Number(t.percent),
            maxBonus: twoPlaces(t.maxBonus),
          }))
        : [],
      wagerMultiplier: terms.wagerMultiplier,
      expiryDays: terms.expiryDays,
      wageringLock: await this.playerBonuses.lockOn(),
      claimed: null,
      // hash.game's program (migration 136): 'monthly' = the Nth deposit of the month gets schedule[N-1].
      program: {
        mode: terms.program.mode,
        unlockMode: terms.program.unlockMode,
        unlockRatePercent: String(Number(terms.program.unlockRate) * 100),
        schedule: terms.program.schedule.map((t) => ({ percent: Number(t.percent), minDeposit: twoPlaces(t.minDeposit), maxBonus: twoPlaces(t.maxBonus) })),
        usedThisMonth: null,
      },
    };
    if (terms.program.mode === 'monthly') {
      base.enabled = terms.enabled && terms.program.schedule.length > 0;
      if (!userId) return base;
      base.program.usedThisMonth = await this.#monthlyUsed(userId);
      let agent = true;
      try {
        agent = await promotionsBlocked(userId);
      } catch {
        agent = true;
      }
      base.eligible = base.enabled && !agent && base.program.usedThisMonth < terms.program.schedule.length;
      return base;
    }
    if (!userId) return base;

    const granted = await this.models.PlayerBonus?.findOne({
      where: { grant_key: keyFor(userId) },
      attributes: ['amount', 'currency', 'granted_at', 'status'],
      raw: true,
    });
    if (granted) {
      base.claimed = {
        amount: money.toDecimalString(money.toMinorQuantised(String(granted.amount))),
        currency: granted.currency,
        at: new Date(granted.granted_at).toISOString(),
        status: granted.status,
      };
      return base;
    }
    const paid = await this.models.CreditsLedger.findOne({
      where: { idempotency_key: keyFor(userId) },
      attributes: ['amount', 'currency', 'created_at'],
      raw: true,
    });
    if (paid) {
      base.claimed = {
        amount: money.toDecimalString(money.abs(paid.amount)),
        currency: paid.currency,
        at: new Date(paid.created_at).toISOString(),
      };
      return base;
    }
    if (!enabled) return base;

    let agent = true;
    try {
      agent = await promotionsBlocked(userId);
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId) }, 'First deposit bonus: agent-tree check failed — reporting not eligible');
    }
    base.eligible = !agent && !(await this.#hasDeposited(userId));
    return base;
  }

  /**
   * @param {object} deposit
   * @param {number|string} deposit.userId
   * @param {string} deposit.currency  what the deposit credited
   * @param {string} deposit.amount    what the deposit credited
   * @param {number|string} deposit.ledgerId the deposit's credits_ledger row
   * @param {string} deposit.source    e.g. FIAT_DEPOSIT, CRYPTO_DEPOSIT, PSP_UPI
   * @param {string} deposit.refId     the deposit's own reference
   */
  async onDepositCredited(deposit) {
    /**
     * The referrer's joining bonus waits for this point (anti sign-up farming,
     * `affiliateBonusRequiresDeposit`). Every deposit path already calls this
     * method, so the gate covers all of them. It never throws.
     */
    if (deposit?.userId) {
      try {
        await this.#affiliate().onRefereeDeposit({ userId: deposit.userId });
      } catch (error) {
        this.logger?.warn({ err: error, userId: String(deposit.userId) }, 'Affiliate joining bonus hook failed');
      }
    }

    /**
     * The first-deposit bonus and the player's spin-wheel code are NOT stacked: on a deposit
     * where both would pay, only the LARGER is granted (a tie goes to the first-deposit bonus).
     *
     * When the spin code loses, it is NOT burned: it stays active and applies to the player's
     * next deposit. The wheel promises the code for "your next deposit", and the first-deposit
     * bonus can only ever win once, so keeping the code costs nothing and keeps the promise.
     * When the spin code wins on the first deposit, the first-deposit bonus is simply not paid
     * (it is only ever for the first deposit, so it is gone).
     */
    let terms = { enabled: false, tiers: [], wagerMultiplier: null, expiryDays: null, program: { mode: 'first', schedule: [] } };
    let first;
    try {
      terms = await this.#terms();
      first = await this.#quote(deposit, terms);
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(deposit?.userId) }, 'First deposit bonus quote failed');
      first = { paid: false, reason: 'ERROR' };
    }
    let spin;
    try {
      const isFirstDeposit = Boolean(deposit?.userId && deposit?.ledgerId) && (await this.#isFirstDeposit(deposit));
      spin = await this.spinBonus.quote(deposit ?? {}, { isFirstDeposit });
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(deposit?.userId) }, 'Spin wheel bonus quote failed');
      spin = { ok: false, reason: 'ERROR' };
    }

    const spinWins = spin.ok && (!first.quote || money.gt(spin.amount, first.quote.bonusAmount));
    let result = first.quote ? { paid: false, reason: 'SPIN_BONUS_LARGER' } : first;
    let spinWheelBonus = spin.ok ? { paid: false, reason: 'FIRST_DEPOSIT_BONUS_LARGER' } : { paid: false, reason: spin.reason };

    if (first.quote && !spinWins) {
      try {
        result = await this.#pay(deposit, first.quote, terms);
        if (result.paid) {
          this.logger?.info({ userId: String(deposit.userId), ...result, source: deposit.source }, 'First deposit bonus paid');
          const monthly = Boolean(first.quote.monthly);
          void notifyPlayer(deposit.userId, {
            kind: 'first_deposit_bonus',
            key: monthly ? `bonus:deposit:${first.quote.monthly.month}:${first.quote.monthly.n}` : 'bonus:first-deposit',
            title: monthly ? `Deposit bonus ${first.quote.monthly.n}` : 'First deposit bonus',
            body: result.locked
              ? '{amount} deposit bonus is locked in your bonus balance. Every bet unlocks part of it — claim it any time.'
              : '{amount} deposit bonus has been added to your wallet.',
            link: result.locked ? '/wallet' : '/bonus',
            meta: { amount: result.amount, currency: result.currency },
          });
        }
      } catch (error) {
        this.logger?.warn(
          { err: error, userId: String(deposit?.userId), source: deposit?.source, refId: deposit?.refId },
          'First deposit bonus was not applied — the deposit itself is unaffected'
        );
        result = { paid: false, reason: 'ERROR' };
      }
    }

    if (spinWins) {
      try {
        spinWheelBonus = await this.spinBonus.pay(spin, {
          userId: deposit.userId, source: deposit.source, refId: deposit.refId, wagerMultiplier: terms.wagerMultiplier,
        });
        if (spinWheelBonus.paid) {
          this.logger?.info({ userId: String(deposit.userId), ...spinWheelBonus, source: deposit.source }, 'Spin wheel bonus paid');
          void notifyPlayer(deposit.userId, {
            kind: 'spin_wheel_bonus',
            key: `bonus:spin-wheel:${deposit.source}:${deposit.refId}`,
            title: 'Spin wheel bonus',
            body: spinWheelBonus.locked
              ? '{amount} spin wheel bonus has been added to your bonus balance. Wager it to unlock it as cash.'
              : '{amount} spin wheel bonus has been added to your wallet.',
            link: spinWheelBonus.locked ? '/wallet' : '/bonus',
            meta: { amount: spinWheelBonus.amount, currency: spinWheelBonus.currency },
          });
        }
      } catch (error) {
        this.logger?.warn(
          { err: error, userId: String(deposit?.userId), source: deposit?.source, refId: deposit?.refId },
          'Spin wheel bonus was not applied — the deposit itself is unaffected'
        );
        spinWheelBonus = { paid: false, reason: 'ERROR' };
      }
    }

    return { ...result, spinWheelBonus };
  }

  /**
   * Every check, and the amount, without paying: `{ quote }` when the bonus would be paid,
   * otherwise `{ paid: false, reason }`.
   */
  async #quote(deposit = {}, terms) {
    if (terms.program?.mode === 'monthly') return this.#monthlyQuote(deposit, terms);
    const { userId, currency, amount, ledgerId, source, refId } = deposit;
    if (!terms.enabled || !terms.tiers.length) return { paid: false, reason: 'DISABLED' };
    if (!userId || !ledgerId || !currency || !money.gt(amount ?? '0', '0')) {
      return { paid: false, reason: 'NO_DEPOSIT' };
    }

    if (await promotionsBlocked(userId)) {
      this.logger?.info({ userId: String(userId) }, 'First deposit bonus skipped: agent-tree player');
      return { paid: false, reason: 'AGENT_TREE_PLAYER' };
    }

    const already =
      (await this.models.PlayerBonus?.findOne({ where: { grant_key: keyFor(userId) }, attributes: ['id'], raw: true })) ??
      (await this.models.CreditsLedger.findOne({
        where: { idempotency_key: keyFor(userId) },
        attributes: ['id'],
        raw: true,
      }));
    if (already) return { paid: false, reason: 'ALREADY_PAID' };

    if (!(await this.#isFirstDeposit({ userId, ledgerId, source, refId }))) {
      return { paid: false, reason: 'NOT_FIRST_DEPOSIT' };
    }

    const code = String(currency).toUpperCase();
    const deposited = money.toDecimalString(money.toMinor(amount));
    const quote = await this.rewardMoney.toReward(deposited, code);
    if (quote === null) {
      this.logger?.warn({ from: code }, 'First deposit bonus: no exchange rate for the deposit currency');
      return { paid: false, reason: 'NO_EXCHANGE_RATE' };
    }
    const value = quote.amount;
    const rewardCurrency = quote.currency;
    const usd = await this.rewardMoney.toUsd(deposited, code);

    const tier = [...terms.tiers].reverse().find((t) => money.gte(value, t.minDeposit));
    if (!tier) {
      return { paid: false, reason: 'BELOW_MINIMUM', depositUsd: usd, depositValue: value, minDeposit: terms.tiers[0].minDeposit };
    }

    let bonus = money.percentOf(value, tier.percent);
    if (money.gt(tier.maxBonus, '0')) bonus = money.min(bonus, tier.maxBonus);
    const bonusAmount = money.toDecimalString(bonus);
    if (!money.gt(bonusAmount, '0')) return { paid: false, reason: 'ZERO_BONUS' };

    return { quote: { bonusAmount, rewardCurrency, value, usd, tier, code, deposited } };
  }

  /**
   * hash.game "Monthly Deposit Bonus": "Get 4 deposit bonuses every month … All 4 chances reset on
   * the 1st of each month at 00:00 UTC." The Nth credited deposit of the month (that reaches its
   * row's minimum) gets `schedule[N-1]`: deposit × percent, capped by maxBonus when set.
   */
  async #monthlyQuote({ userId, currency, amount, ledgerId } = {}, terms) {
    const schedule = terms.program.schedule;
    if (!terms.enabled || !schedule.length) return { paid: false, reason: 'DISABLED' };
    if (!userId || !ledgerId || !currency || !money.gt(amount ?? '0', '0')) return { paid: false, reason: 'NO_DEPOSIT' };
    if (await promotionsBlocked(userId)) return { paid: false, reason: 'AGENT_TREE_PLAYER' };

    const used = await this.#monthlyUsed(userId);
    if (used >= schedule.length) return { paid: false, reason: 'MONTHLY_LIMIT_REACHED', used };
    const tier = schedule[used];

    const code = String(currency).toUpperCase();
    const deposited = money.toDecimalString(money.toMinor(amount));
    const quote = await this.rewardMoney.toReward(deposited, code);
    if (quote === null) return { paid: false, reason: 'NO_EXCHANGE_RATE' };
    const value = quote.amount;
    const usd = await this.rewardMoney.toUsd(deposited, code);
    if (!money.gte(value, tier.minDeposit)) {
      return { paid: false, reason: 'BELOW_MINIMUM', depositUsd: usd, depositValue: value, minDeposit: tier.minDeposit };
    }

    let bonus = money.percentOf(value, tier.percent);
    if (money.gt(tier.maxBonus, '0')) bonus = money.min(bonus, tier.maxBonus);
    const bonusAmount = money.toDecimalString(bonus);
    if (!money.gt(bonusAmount, '0')) return { paid: false, reason: 'ZERO_BONUS' };

    const { label } = this.#month();
    return {
      quote: { bonusAmount, rewardCurrency: quote.currency, value, usd, tier, code, deposited, monthly: { n: used + 1, month: label } },
    };
  }

  /**
   * Grant the bonus: to the locked bonus balance (wagering lock on, a multiplier set) or straight
   * to cash (`../player-bonuses` decides, and records it either way).
   */
  async #pay({ userId, source, refId }, quote, terms) {
    const { bonusAmount, rewardCurrency, value, usd, tier, code, deposited, monthly } = quote;
    const pct = Number(tier.percent);
    const gradual = terms.program?.unlockMode === 'gradual';
    const rollover = gradual
      ? `, unlocks as you wager (${Number(terms.program.unlockRate) * 100}% of wager × house edge)`
      : terms.wagerMultiplier ? `, wager ${terms.wagerMultiplier}x` : '';
    const grant = await this.playerBonuses.grant({
      userId,
      source: monthly ? BONUS_SOURCE.MONTHLY_DEPOSIT : BONUS_SOURCE.FIRST_DEPOSIT,
      grantKey: monthly ? monthlyKeyFor(userId, monthly) : keyFor(userId),
      ref: `${source}:${refId}`,
      amount: bonusAmount,
      currency: rewardCurrency,
      wagerMultiplier: terms.wagerMultiplier,
      expiryDays: terms.expiryDays,
      unlockMode: gradual ? 'gradual' : 'rollover',
      unlockRate: terms.program?.unlockRate,
      description:
        `${monthly ? `Deposit bonus ${monthly.n} (${monthly.month})` : 'First deposit bonus'}: ${pct}% of ${twoPlaces(value)} ${rewardCurrency}` +
        (code === rewardCurrency ? '' : ` (${twoPlaces(deposited)} ${code})`) +
        rollover,
    });

    return {
      paid: grant.paid,
      reason: grant.paid ? undefined : grant.reason,
      locked: grant.locked === true,
      bonusId: grant.bonusId,
      requiredWager: grant.requiredWager,
      expiresAt: grant.expiresAt ?? null,
      amount: bonusAmount,
      currency: rewardCurrency,
      depositUsd: usd,
      depositValue: value,
      tier,
      ledgerId: grant.ledgerId,
    };
  }

  /** Any credited deposit at all — what `eligible` means to the player. */
  async #hasDeposited(userId) {
    const ledger = await this.models.CreditsLedger.findOne({
      where: { user_id: String(userId), reason: REASON.DEPOSIT },
      attributes: ['id'],
      raw: true,
    });
    if (ledger) return true;
    const fiat = await this.models.FiatDeposits?.findOne({
      where: { user_id: userId, status: 'approved' },
      attributes: ['deposit_id'],
      raw: true,
    });
    return Boolean(fiat);
  }

  /** Is the deposit behind `ledgerId` this player's first? */
  async #isFirstDeposit({ userId, ledgerId, source, refId }) {
    const earlier = await this.models.CreditsLedger.findOne({
      where: { user_id: String(userId), reason: REASON.DEPOSIT, id: { [Op.lt]: ledgerId } },
      attributes: ['id'],
      raw: true,
    });
    if (earlier) return false;

    // Approved before the ledger existed (or by a legacy path that wrote none).
    const otherFiat = await this.models.FiatDeposits?.findOne({
      where: {
        user_id: userId,
        status: 'approved',
        ...(source === 'FIAT_DEPOSIT' ? { deposit_id: { [Op.ne]: Number(refId) } } : {}),
      },
      attributes: ['deposit_id'],
      raw: true,
    });
    return !otherFiat;
  }
}

/** "10.00000000" → "10.00" for display; exact decimals stay in the ledger. */
function twoPlaces(value) {
  const [whole, fraction = ''] = money.toDecimalString(money.toMinor(value ?? '0')).split('.');
  return `${whole}.${fraction.slice(0, 2).padEnd(2, '0')}`;
}

module.exports = { FirstDepositBonusService, REF_TYPE, keyFor, monthlyKeyFor };
