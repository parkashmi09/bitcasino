'use strict';

const { money, sitePolicy, defineErrors, entitlements, withdrawalCap, withdrawalDailyLimit } = require('@ibitplay/common');

const { WagerService } = require('../wager/wager.service');
const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
const { createRewardMoney } = require('../../lib/rewardMoney');
const { createCapFigures } = require('./withdrawCap');

/**
 * Withdrawal requirements — the owner's `withdrawal_requirements` policy, checked in ONE place.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE POLICY (owner panel, packages/common/src/featureCatalogue.js)
 *
 *   none           nothing is required
 *   kyc            KYC Verified (the default — what every rail did before the policy)
 *   wager          every open wagering requirement complete
 *   kyc_and_wager  both
 *
 * Since 2026-10-21 the wagering check is in force under EVERY variant (the user's rule: no
 * withdrawal before the deposit rollover is complete), so the policy now only switches KYC.
 *
 * KYC also needs `WITHDRAW_REQUIRE_KYC` on (the deployment's switch, default on): an env that
 * turns KYC off turns it off whatever the policy says, as it always did.
 *
 * ── "WAGERING COMPLETE" ─────────────────────────────────────────────────
 *
 *   bonus    no active bonus with wagering left (`player_bonuses`, the bonus wagering lock);
 *   deposit  the deposit rollover (`/user/wager/tasks`: approved deposits × multiplier, in USD)
 *            complete. It is the platform's only deposit-turnover rule.
 *
 * Totals are in USD (the rollover's unit; a bonus is converted at the current rate, USDT = 1,
 * and a coin with no rate counts at face value — never as zero).
 *
 * ── THE BONUS PART IS THE PLAYER'S TO CLEAR ─────────────────────────────
 *
 * Forfeiting a bonus clears its wagering. So the wager refusal (403 WITHDRAW_WAGER_REQUIRED) is
 * only for an incomplete DEPOSIT rollover; a withdrawal whose only open wagering is a bonus goes
 * on to the existing 409 BONUS_FORFEIT_REQUIRED, and `forfeitBonus: true` forfeits it and passes.
 * That keeps the confirm-and-forfeit flow exactly as it was. `remaining` in the refusal counts
 * the bonus part too unless the request already forfeits it.
 *
 * ── THE DEPOSIT CAP (the third switch, `withdrawalCap` in the owner's document) ──────────
 *
 * Per currency, in that currency (packages/common/src/withdrawalCap.js, figures in
 * ./withdrawCap.js): cap = deposited × multiplier + min(wagered, deposited × wager multiplier),
 * remaining = cap − withdrawn (pending and paid). A withdrawal over `remaining` → 403
 * WITHDRAW_CAP_EXCEEDED `{ cap, withdrawn, remaining, deposited, wagered, unlockedByWager,
 * wagerToRaise, currency }`. Checked after KYC and wagering (so a bonus is never forfeited for
 * a withdrawal that is refused anyway), and again inside the rail's transaction under a
 * per-player lock (`assertCapInTransaction`), so two requests at once cannot both fit under it.
 * FAILS CLOSED: a figure that cannot be read, or a rail that does not name amount and
 * currency, refuses with 503 WITHDRAW_CAP_CHECK_FAILED.
 *
 * ── THE DAILY LIMIT (the fourth switch, `withdrawalDailyLimit`) ──────────────────────────
 *
 * Per currency, in that currency (packages/common/src/withdrawalDailyLimit.js): at most
 * `limits[currency]` out in any rolling 24 hours, pending and paid counted on every rail (P2P
 * sells included). Over it → 403 WITHDRAW_DAILY_LIMIT `{ currency, limit, usedToday, remaining,
 * attempted }`. Checked with the cap (before any bonus forfeit) and again under the same
 * per-player lock inside the rail's transaction. Fails closed like the cap (503
 * WITHDRAW_CAP_CHECK_FAILED when the usage cannot be read). A currency with no entry has no limit.
 *
 * Any combination of the four switches; each refusal is its own code.
 *
 * Agent-tree players never reach here: every rail refuses them first (WITHDRAW_NOT_FOR_AGENT_USERS).
 * ═════════════════════════════════════════════════════════════════════════
 */

const POLICY = 'withdrawal_requirements';
const ZERO = '0.00000000';
const UNIT = 'USD';

const errors = defineErrors('WITHDRAW', {
  /** Details `{ remaining, currency, deposit, bonus, forfeitable }` — see the module note. */
  WAGER_REQUIRED: {
    status: 403,
    message: 'Complete your wagering requirement before withdrawing',
  },
  /**
   * Over the deposit cap. Details `{ cap, withdrawn, remaining, deposited, wagered,
   * unlockedByWager, wagerToRaise, currency }` (decimal strings); the message names the figures.
   */
  CAP_EXCEEDED: {
    status: 403,
    message: 'This withdrawal is over your withdrawal limit',
  },
  /**
   * Over the owner's daily limit for the currency. Details `{ currency, limit, usedToday,
   * remaining, attempted }` (decimal strings); the message names the limit and what is left.
   */
  DAILY_LIMIT: {
    status: 403,
    message: 'This withdrawal is over your daily withdrawal limit',
  },
  /** The cap could not be checked (a figure unreadable, or no amount / currency): refused. */
  CAP_CHECK_FAILED: {
    status: 503,
    message: 'Unable to process withdrawal right now. Please try again later.',
  },
});

/** "1,234.5" — at most 8 places, grouped, trailing zeros dropped. */
function fmt(value) {
  const [whole, fraction = ''] = String(value).split('.');
  const neg = whole.startsWith('-');
  const digits = (neg ? whole.slice(1) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = fraction.replace(/0+$/, '');
  return `${neg ? '-' : ''}${digits}${frac ? `.${frac}` : ''}`;
}

/** The player-facing refusal, addaplay's wording. */
function capMessage(c) {
  const basis = c.wagerBonusEnabled
    ? `${fmt(c.multiplier)}× your total deposits + ${fmt(c.unlockedByWager)} ${c.currency} unlocked by wagering`
    : `${fmt(c.multiplier)}× your total deposits`;
  const raise = money.gt(c.wagerToRaise, '0')
    ? `Wager ${fmt(c.wagerToRaise)} ${c.currency} more or deposit to raise your limit.`
    : 'Deposit more to raise your limit.';
  return money.gt(c.remaining, '0')
    ? `You can withdraw up to ${fmt(c.remaining)} ${c.currency} more (${basis}). ${raise}`
    : `Withdrawal limit reached (${basis}). ${raise}`;
}

const capDetails = (c) => ({
  cap: c.cap,
  withdrawn: c.withdrawn,
  remaining: c.remaining,
  deposited: c.deposited,
  wagered: c.wagered,
  unlockedByWager: c.unlockedByWager,
  wagerToRaise: c.wagerToRaise,
  currency: c.currency,
});

/** "Daily withdrawal limit is 50,000 INR; 12,000 INR left today." */
function dailyMessage(d) {
  return money.gt(d.remaining, '0')
    ? `Daily withdrawal limit is ${fmt(d.limit)} ${d.currency}; ${fmt(d.remaining)} ${d.currency} left today.`
    : `Daily withdrawal limit of ${fmt(d.limit)} ${d.currency} reached. Try again in 24 hours.`;
}

const dec = (minor) => money.toDecimalString(minor);
const sum = (values) => dec(values.reduce((acc, v) => acc + money.toMinor(v), 0n));

function createWithdrawRequirements(deps) {
  const { models, config, logger } = deps;
  const wager = deps.wagerService ?? new WagerService(deps);
  const bonuses = deps.playerBonuses ?? new PlayerBonusService(deps);
  const rewardMoney = deps.rewardMoney ?? createRewardMoney(deps);
  const kycSwitch = config?.WITHDRAW_REQUIRE_KYC !== false;
  const capFigures = deps.capFigures ?? createCapFigures(deps);
  const dailyFigures = deps.dailyFigures ?? withdrawalDailyLimit.createDailyFigures(deps);

  /**
   * The deposit-cap settings in force: the owner's only (the signed document's `withdrawalCap`,
   * defaults filled). The site admin shows them read-only; whatever an older admin saved in
   * `withdrawal_control` is no longer read.
   */
  async function ownerSettings() {
    const plan = await entitlements.getEntitlements();
    return {
      kycFeature: entitlements.isFeatureEntitledIn(plan, 'kyc'),
      cap: withdrawalCap.cleanWithdrawalCap(plan.withdrawalCap),
      daily: withdrawalDailyLimit.cleanWithdrawalDailyLimit(plan.withdrawalDailyLimit),
    };
  }

  /**
   * `{ policy, kyc, wager, cap, daily }` — which checks are in force now. Read on every call, no
   * cache. `cap` is the deposit cap's settings (`cap.enabled` = the switch), `daily` the daily
   * limit's (`daily.enabled`, `daily.limits`).
   */
  async function rules() {
    const [policy, owner] = await Promise.all([sitePolicy.readPolicy(models, POLICY), ownerSettings()]);
    const requires = (what) => (sitePolicy.ALLOWS[POLICY][what] ?? []).includes(policy);
    // KYC is only demanded while the owner's KYC feature is in the plan: with it off the player
    // cannot submit documents, so requiring them would stop every withdrawal.
    // The deposit rollover is required whatever the policy (user, 2026-10-21: no withdrawal before the
    // rollover is complete). Multiplier 0 makes the target 0, which clears it.
    return { policy, kyc: requires('kyc') && kycSwitch && owner.kycFeature, wager: true, cap: owner.cap, daily: owner.daily };
  }

  /**
   * `{ enabled, currency, limit, used, remaining }` for one currency — `enabled` false (figures
   * null) when the switch is off or the currency has no limit. Throws on a DB error.
   */
  async function dailyFor(userId, currency, daily, { transaction } = {}) {
    const cur = String(currency).toUpperCase();
    const limit = withdrawalDailyLimit.limitFor(daily, cur);
    if (!limit) return { enabled: false, currency: cur, limit: null, used: null, remaining: null };
    const used = await dailyFigures.used(userId, cur, { transaction });
    return { enabled: true, currency: cur, ...withdrawalDailyLimit.computeDaily({ limit, used }) };
  }

  /** Refuse `amount` `currency` over the daily limit. Fails closed like the cap. */
  async function checkDaily(userId, { amount, currency, daily, transaction }) {
    if (!withdrawalDailyLimit.limitFor(daily, currency)) return null;
    let requested;
    try {
      requested = money.toMinor(String(amount));
    } catch {
      requested = null;
    }
    if (requested == null || requested <= 0n) {
      logger?.error({ userId: String(userId), currency }, 'Daily withdrawal limit: the rail named no amount — refused');
      throw errors.CAP_CHECK_FAILED();
    }
    let d;
    try {
      d = await dailyFor(userId, currency, daily, { transaction });
    } catch (error) {
      logger?.error({ err: error, userId: String(userId), currency }, 'Daily withdrawal limit could not be checked — refused');
      throw errors.CAP_CHECK_FAILED();
    }
    if (requested > money.toMinor(d.remaining)) {
      const details = { currency: d.currency, limit: d.limit, usedToday: d.used, remaining: d.remaining, attempted: dec(requested) };
      logger?.info({ userId: String(userId), ...details }, 'Withdrawal refused: over the daily limit');
      throw errors.DAILY_LIMIT(details, { message: dailyMessage(d) });
    }
    return d;
  }

  /** The per-player lock both in-transaction checks share: a second request waits for the first. */
  async function lockPlayer(userId, transaction) {
    await deps.db.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `withdraw-cap:${userId}` },
      transaction,
    });
  }

  /**
   * The daily limit alone, inside a rail's transaction and under the player lock — for a rail
   * that does not run `assertMet` (P2P sell). Reads the owner's settings itself.
   */
  async function assertDailyInTransaction(userId, { amount, currency, transaction }) {
    const { daily } = await ownerSettings();
    if (!withdrawalDailyLimit.limitFor(daily, currency)) return null;
    await lockPlayer(userId, transaction);
    return checkDaily(userId, { amount, currency, daily, transaction });
  }

  /** The cap block for one currency. Throws on a DB error (callers decide: refuse or answer). */
  async function capFor(userId, currency, settings, { transaction } = {}) {
    const cur = String(currency).toUpperCase();
    const f = await capFigures.figures(userId, cur, { transaction, wagered: settings.wagerBonus });
    return withdrawalCap.computeCap({ currency: cur, ...f, settings });
  }

  /**
   * Refuse a withdrawal of `amount` `currency` over the cap. Fails closed: no amount / currency,
   * or a figure that cannot be read → 503 WITHDRAW_CAP_CHECK_FAILED.
   */
  async function checkCap(userId, { amount, currency, settings, transaction }) {
    let requested;
    try {
      requested = money.toMinor(String(amount));
    } catch {
      requested = null;
    }
    if (!currency || requested == null || requested <= 0n) {
      logger?.error({ userId: String(userId), currency }, 'Withdrawal cap: the rail named no amount / currency — refused');
      throw errors.CAP_CHECK_FAILED();
    }
    let c;
    try {
      c = await capFor(userId, currency, settings, { transaction });
    } catch (error) {
      logger?.error({ err: error, userId: String(userId), currency }, 'Withdrawal cap could not be checked — refused');
      throw errors.CAP_CHECK_FAILED();
    }
    if (requested > money.toMinor(c.remaining)) {
      logger?.info({ userId: String(userId), amount: String(amount), ...capDetails(c) }, 'Withdrawal refused: over the deposit cap');
      throw errors.CAP_EXCEEDED(capDetails(c), { message: capMessage(c) });
    }
    return c;
  }

  /**
   * The cap again, INSIDE the rail's transaction, before its row and hold: a per-player
   * transaction lock makes a second request wait for the first to commit, and then its read
   * sees the first one's pending row. `applied` is what `assertMet` returned (no-op when the
   * cap was off).
   */
  async function assertCapInTransaction(userId, { amount, currency, transaction, applied }) {
    const capOn = Boolean(applied?.cap?.enabled);
    const dailyOn = Boolean(applied?.daily && withdrawalDailyLimit.limitFor(applied.daily, currency));
    if (!capOn && !dailyOn) return;
    await lockPlayer(userId, transaction);
    if (capOn) await checkCap(userId, { amount, currency, settings: applied.cap, transaction });
    if (dailyOn) await checkDaily(userId, { amount, currency, daily: applied.daily, transaction });
  }

  /** The player's latest `user_kyc` row (user_id is VARCHAR in the legacy schema). */
  async function kycStatus(userId) {
    const row = await models.UserKyc.findOne({
      where: { user_id: String(userId) },
      order: [['id', 'DESC']],
      attributes: ['status'],
      raw: true,
    });
    const status = row?.status ?? 'NotSubmitted';
    return { status, verified: status === 'Verified' };
  }

  async function usd(amount, currency) {
    const value = await rewardMoney.toUsd(amount, currency);
    if (value == null) {
      logger?.warn({ currency }, 'Withdrawal requirements: no USD rate for a bonus currency — counted at face value');
      return amount;
    }
    return dec(money.toMinorQuantised(value));
  }

  /** The open wagering: `{ bonus, deposit }`, both in USD. */
  async function openWagering(userId) {
    const [open, tasks] = await Promise.all([bonuses.openWagering(userId), wager.getTasks(userId)]);

    const bonusRemaining = sum(await Promise.all(open.map((b) => usd(b.remaining, b.currency))));
    const task = tasks.tasks.find((t) => t.kind === 'deposit') ?? null;
    const depositRemaining = sum(tasks.tasks.filter((t) => t.status !== 'complete').map((t) => t.remaining));

    return {
      bonus: {
        remaining: bonusRemaining,
        currency: UNIT,
        bonuses: open,
      },
      deposit: {
        remaining: depositRemaining,
        currency: UNIT,
        target: task?.target ?? ZERO,
        wagered: task?.wagered ?? ZERO,
        multiplier: tasks.multiplier ?? null,
      },
    };
  }

  /**
   * The full answer for a player — `GET /user/withdrawals/requirements`. Both checks are read
   * whatever the policy (a page can show progress), `required` says which are enforced.
   */
  async function evaluate(userId, { currency } = {}) {
    const [r, kyc, open] = await Promise.all([rules(), kycStatus(userId), openWagering(userId)]);
    const remaining = sum([open.bonus.remaining, open.deposit.remaining]);
    const done = money.lte(remaining, '0');
    const missing = [];
    if (r.kyc && !kyc.verified) missing.push('kyc');
    if (r.wager && !done) missing.push('wager');

    // The deposit cap: one block for `?currency=`, else one per currency the player has used.
    // Figures only while the switch is on (null otherwise).
    const capSettingsOut = { enabled: r.cap.enabled, multiplier: r.cap.depositMultiplier, wagerBonusEnabled: r.cap.wagerBonus, wagerMultiplier: r.cap.wagerMultiplier };
    const capBlock = async (cur) => {
      if (!r.cap.enabled) {
        return { ...capSettingsOut, currency: cur, deposited: null, withdrawn: null, wagered: null, cap: null, remaining: null, wagerToRaise: null, unlockedByWager: null };
      }
      const c = await capFor(userId, cur, r.cap);
      return { ...capSettingsOut, currency: c.currency, deposited: c.deposited, withdrawn: c.withdrawn, wagered: c.wagered, cap: c.cap, remaining: c.remaining, wagerToRaise: c.wagerToRaise, unlockedByWager: c.unlockedByWager };
    };
    let cap;
    let dailyLimit;
    if (currency) {
      cap = await capBlock(String(currency).toUpperCase());
      if (cap.enabled && money.lte(cap.remaining, '0')) missing.push('cap');
      dailyLimit = await dailyFor(userId, currency, r.daily);
      if (dailyLimit.enabled && money.lte(dailyLimit.remaining, '0')) missing.push('daily');
    } else {
      const used = r.cap.enabled ? await capFigures.currencies(userId) : [];
      cap = { ...capSettingsOut, currencies: await Promise.all(used.map(capBlock)) };
      const limited = r.daily.enabled ? Object.keys(r.daily.limits) : [];
      dailyLimit = { enabled: r.daily.enabled, currencies: await Promise.all(limited.map((cur) => dailyFor(userId, cur, r.daily))) };
    }

    return {
      policy: r.policy,
      ok: missing.length === 0,
      missing,
      kyc: { required: r.kyc, status: kyc.status, verified: kyc.verified },
      wager: {
        required: r.wager,
        done,
        remaining,
        // What would still block after the player forfeits their bonuses.
        remainingAfterForfeit: open.deposit.remaining,
        currency: UNIT,
        bonus: open.bonus,
        deposit: open.deposit,
      },
      // Any active bonus is forfeited by a withdrawal (409 BONUS_FORFEIT_REQUIRED, then
      // `forfeitBonus: true`), whatever the policy: bonus money is never cash.
      bonusForfeitRequired: open.bonus.bonuses.length > 0,
      cap,
      // The owner's daily limit (rolling 24 hours): one block for `?currency=`, else one per limited currency.
      dailyLimit,
    };
  }

  /**
   * The rail's check, after its cooldown and before the bonus forfeit. `kycError(status)` builds
   * the rail's own `*_KYC_REQUIRED`. Returns the rules applied.
   */
  async function assertMet(userId, { forfeitBonus = false, kycError, amount, currency }) {
    const r = await rules();
    if (r.kyc) {
      const kyc = await kycStatus(userId);
      if (!kyc.verified) throw kycError(kyc.status);
    }
    if (r.wager) {
      const open = await openWagering(userId);
      if (money.gt(open.deposit.remaining, '0')) {
        const remaining = forfeitBonus ? open.deposit.remaining : sum([open.deposit.remaining, open.bonus.remaining]);
        logger?.info({ userId: String(userId), remaining, policy: r.policy }, 'Withdrawal refused: wagering incomplete');
        const message = `Complete your wagering requirement before withdrawing — ${Number(open.deposit.wagered).toFixed(2)} of ${Number(open.deposit.target).toFixed(2)} ${UNIT} wagered`;
        throw errors.WAGER_REQUIRED({
          remaining,
          currency: UNIT,
          deposit: { remaining: open.deposit.remaining, target: open.deposit.target, wagered: open.deposit.wagered },
          bonus: { remaining: forfeitBonus ? ZERO : open.bonus.remaining, count: open.bonus.bonuses.length },
          forfeitable: !forfeitBonus && open.bonus.bonuses.length > 0,
        }, { message });
      }
      // Only bonus wagering open: the rail's bonus check answers 409 BONUS_FORFEIT_REQUIRED,
      // and a confirmed forfeit clears it.
    }
    // The deposit cap, before the bonus forfeit (never forfeit for a refused withdrawal). The
    // rail checks it again under its lock (`assertCapInTransaction`).
    if (r.cap.enabled) await checkCap(userId, { amount, currency, settings: r.cap });
    // The daily limit, likewise before any forfeit; again under the lock in the rail.
    if (r.daily.enabled && currency) await checkDaily(userId, { amount, currency, daily: r.daily });
    return r;
  }

  return { rules, evaluate, assertMet, assertCapInTransaction, assertDailyInTransaction, kycStatus, capFor, dailyFor };
}

module.exports = { createWithdrawRequirements, withdrawRequirementErrors: errors, POLICY };
