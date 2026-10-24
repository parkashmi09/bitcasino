'use strict';

const { literal, QueryTypes } = require('sequelize');
const { money, wagerCategory } = require('@ibitplay/common');

const { ExchangeRateService } = require('../exchange-rate/exchangeRate.service');
const { VipService } = require('../vip/vip.service');
const { AffiliateService } = require('../affiliate/affiliate.service');
const { RakebackService } = require('../rakeback/rakeback.service');
const { REASON: RAKEBACK_REASON } = require('../rakeback/rakeback.constants');
const { reversedTarget, settleItem, ZERO } = require('./stakeShare');

/** Currencies that ARE dollars — counted 1:1 without a rate lookup. */
const USD_CURRENCIES = Object.freeze(['USDT', 'USD']);

/**
 * Every stake that counts toward `userwager` comes through here — in USD.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE LADDER WAS COUNTED IN RUPEES AND PAID IN DOLLARS
 *
 * casino-service added the raw stake in the bet's own currency to
 * `userwager.wager`. The VIP bands (`packages/common/src/vipLevels.js`), the
 * bonus gates and affiliate commission are all sized in USD, and the level-up
 * and rank-up credits pay USDT — so on an INR site ₹1,500 of play (~$18)
 * crossed bands worth 6.5 USDT, and a referee's ₹1,000 paid their referrer
 * 50 USDT of commission.
 *
 * `userwager.wager` is a USD figure from here on: the stake is converted
 * through `exchangerate` (the same `from → USD` leg every conversion uses)
 * BEFORE it is added. `usd_amount` on the activity row is what was counted.
 * A currency with no rate counts nothing — no rate, no guess — and says so.
 *
 * ── ONE PLACE, EVERY PATH ────────────────────────────────────────────────
 *
 * The in-house engine, js-games v1/v2, GIS/Slotegrator and the sports payout
 * worker all post here. Each sends its own `(source, ref)` for the bet, and the
 * unique index on `wager_activity` makes the count exactly-once per bet however
 * often a provider retries or a sports job is requeued.
 *
 * ── WHAT FOLLOWS A COUNTED STAKE ─────────────────────────────────────────
 *
 *   VIP       `vip.onWager(previous, next)` — rakeback rate + level/rank-up
 *             credits, both sides USD now.
 *   Affiliate `affiliate.onWager(previous, next)` — commission on the USD
 *             delta. It is NOT converted again there.
 *   Bonuses   `playerBonuses.onStake(...)` — the stake (in its own currency) moves the
 *             player's active bonuses toward their wagering requirement, oldest first; a
 *             met requirement releases that bonus to cash. `reverse` un-counts it.
 *   Rakeback  `rakeback.accrue({ stakeUsd, source, ref })` — idempotent on the
 *             same `(source, ref)`, so js-games v2 accruals written before this
 *             change are not accrued a second time.
 *
 * All three run AFTER the counter has committed and each is caught and logged:
 * a loyalty side effect must never turn a settled bet into an error the caller
 * retries.
 *
 * ── A REVERSAL THAT LANDS IN BETWEEN ─────────────────────────────────────
 *
 * Because the side effects run after the commit, a refund can arrive after the count and
 * before them: it finds no accrual, no allocation and no commission to undo, and they are
 * written afterwards for a stake that no longer counts. So `#sideEffects` re-reads the
 * stake once it has written them and, if it was (partly) reversed meanwhile, settles what
 * it just wrote to the same pro-rated target the reversal would have (`stakeShare`) —
 * idempotent, so a reversal that DID see them changes nothing twice.
 */
class WagerActivityService {
  constructor(deps) {
    const { models, db, logger } = deps;
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.rates = deps.rates ?? new ExchangeRateService(deps);
    this.vip = deps.vip ?? new VipService(deps);
    this.affiliate = deps.affiliate ?? new AffiliateService(deps);
    this.rakeback = deps.rakeback ?? new RakebackService(deps);
    this.deps = deps;
  }

  /** The bonus wagering lock (`../player-bonuses`), built on first use. */
  #bonuses() {
    if (this.deps.playerBonuses) return this.deps.playerBonuses;
    if (!this.playerBonuses) {
      const { PlayerBonusService } = require('../player-bonuses/playerBonus.service');
      this.playerBonuses = new PlayerBonusService(this.deps);
    }
    return this.playerBonuses;
  }

  /** `amount` of `currency` in USD, or null when there is no usable rate. */
  async toUsd(amount, currency) {
    const code = String(currency ?? '').toUpperCase();
    const value = money.toDecimalString(money.toMinor(String(amount)));
    if (USD_CURRENCIES.includes(code)) return value;
    try {
      const result = await this.rates.convert({ from: code, to: 'USDT', amount: value });
      return result?.usdValue == null ? null : money.toDecimalString(money.toMinor(result.usdValue));
    } catch (error) {
      this.logger?.warn({ err: error, currency: code }, 'No USD rate for stake currency');
      return null;
    }
  }

  /**
   * Count one stake.
   *
   * @returns {{ counted, duplicate, usdAmount, previousWager, newWager, reason? }}
   */
  async record({ userId, amount, currency, source, ref, rakeback = true, category, provider, gameRef, odds, houseEdge }) {
    const code = String(currency ?? '').toUpperCase();
    const stake = money.toDecimalString(money.toMinor(String(amount ?? '0')));
    if (!money.gt(stake, '0')) return { counted: false, duplicate: false, reason: 'NOT_POSITIVE' };

    const usd = await this.toUsd(stake, code);
    if (usd == null) {
      this.logger?.warn({ userId: String(userId), currency: code, source, ref }, 'Stake not counted: no USD rate');
      return { counted: false, duplicate: false, reason: 'NO_RATE' };
    }
    if (!money.gt(usd, '0')) return { counted: false, duplicate: false, reason: 'NOT_POSITIVE' };

    const kind = describeStake({ category, source, provider, gameRef, odds, houseEdge });
    const rateUsed = money.toDecimalString(money.divide(usd, stake));

    let previous;
    let next;
    try {
      ({ previous, next } = await this.db.transaction(async (transaction) => {
        // First, inside the transaction: a duplicate unwinds everything below.
        await this.models.WagerActivity.create(
          {
            user_id: userId,
            source,
            ref: String(ref),
            currency: code,
            amount: stake,
            usd_amount: usd,
            ...kind,
            rate_used: rateUsed,
          },
          { transaction }
        );

        const [row] = await this.models.Userwager.findOrCreate({
          where: { uid: userId },
          defaults: { uid: userId, wager: '0' },
          transaction,
        });
        // Locked, so `previous` and `next` are exact even with two settlements
        // for one player landing together — VIP needs both sides to know
        // whether a band was crossed.
        const locked = await this.models.Userwager.findOne({
          where: { uid: userId },
          transaction,
          lock: transaction.LOCK.UPDATE,
          raw: true,
        });
        const before = cleanWager(locked?.wager ?? row?.wager);
        const after = money.toDecimalString(money.add(before, usd));

        // `wager` is TEXT; the sum is computed here, under the row lock.
        await this.models.Userwager.update({ wager: after }, { where: { uid: userId }, transaction });
        await this.models.UserwagerHistory.create(
          { uid: userId, previous_wager: before, new_wager: after, updated_at: new Date() },
          { transaction }
        );

        return { previous: before, next: after };
      }));
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') {
        this.logger?.info({ userId: String(userId), source, ref }, 'Duplicate wager activity ignored');
        return { counted: false, duplicate: true, usdAmount: usd };
      }
      throw error;
    }

    await this.#sideEffects({ userId, previous, next, usd, source, ref, rakeback, stake, code, kind });

    return { counted: true, duplicate: false, usdAmount: usd, previousWager: previous, newWager: next };
  }

  /**
   * Take a refunded or rolled-back stake back out — all of it, or part of it.
   *
   * The turnover never happened, so its USD leaves `userwager`, its still-unclaimed
   * rakeback leaves `users.rakeamount` (the accrual row keeps its `(source, ref)` so it
   * keeps blocking a re-accrual), its bonus wagering leaves the player's active bonuses,
   * and the referrer's still-UNCLAIMED commission for it is voided (migration 090). The
   * activity row is stamped `reversed_at` once fully reversed, and kept.
   *
   * PARTIAL (`amount` < stake, in the stake's currency, with a `refundRef`): each of the
   * above is pro-rated by the CUMULATIVE refunded share (`wager_activity.reversed_amount`),
   * so several partial refunds add up to exactly one full reversal and can never exceed the
   * stake; the last slice takes the rounding remainder (`stakeShare`). A refund larger than
   * what is left takes what is left; one larger than the stake is refused (EXCEEDS_STAKE).
   * A partial refund without a `refundRef` is refused (REFUND_REF_REQUIRED) — without an id
   * a retried call could not be told from a second refund.
   *
   * NOT clawed back: VIP level/rank-up credits, rakeback already claimed and commission
   * already claimed — the player simply re-earns those bands. The total never goes below 0.
   *
   * A reversal that arrives BEFORE its stake writes a zero tombstone row, so the late bet
   * callback is a duplicate and counts nothing (also for a partial refund: the whole late
   * stake is then left uncounted — the conservative side). Idempotent: a second full
   * reversal, or the same `(source, ref, refundRef)` again, is `duplicate`.
   *
   * @returns {{ reversed, duplicate, partial?, tombstone?, reason?, usdAmount?, previousWager?, newWager?, rakebackReversed?, reversedAmount?, stake? }}
   */
  async reverse({ userId, source, ref, amount = null, refundRef = null }) {
    const result = await this.#reverseCount({ userId, source, ref, amount, refundRef });
    /* The stake's contribution to the player's still-active bonuses comes back out too
       (player-bonuses) — to the same cumulative share. After the commit and caught, like the
       other side effects. Run whenever the stake counted (also for a `duplicate`, so a retried
       reversal finishes the job; the target makes a repeat change nothing). */
    if (result.reversed || result.duplicate) {
      const figures = result.figures;
      delete result.figures;
      try {
        result.bonusReversed = (await this.#settleBonuses({ userId, source, ref, ...figures })).reversed;
      } catch (error) {
        this.logger?.warn({ err: error, userId: String(userId), source, ref }, 'Bonus wagering reversal failed — stake still reversed');
      }
      /* A reversal can drop the player below a band: the rakeback RATE follows the
         reduced total (read under the row lock), so later stakes accrue at the card the
         player is actually on. Paid level/rank-up credits are not clawed back. */
      try {
        const synced = await this.vip.syncRakebackRate?.(userId);
        if (synced) result.rakebackRate = synced.rate;
      } catch (error) {
        this.logger?.warn({ err: error, userId: String(userId), source, ref }, 'Rakeback rate re-sync failed — stake still reversed');
      }
    }
    delete result.figures;
    return result;
  }

  async #reverseCount({ userId, source, ref, amount, refundRef }) {
    const key = String(ref);
    const refundKey = refundRef == null || refundRef === '' ? null : String(refundRef);
    const asked = amount == null || amount === '' ? null : money.toDecimalString(money.toMinor(String(amount)));
    if (asked != null && !money.gt(asked, '0')) return { reversed: false, duplicate: false, reason: 'NOT_POSITIVE' };

    return this.db.transaction(async (transaction) => {
      const [, created] = await this.models.WagerActivity.findOrCreate({
        where: { source, ref: key },
        defaults: {
          user_id: userId, source, ref: key, currency: 'VOID', amount: '0', usd_amount: '0', reversed_at: new Date(),
        },
        transaction,
      });
      if (created) {
        if (refundKey) await this.#logReversal({ userId, source, key, refundKey, amount: asked ?? '0', usd: '0', transaction });
        this.logger?.info({ userId: String(userId), source, ref: key }, 'Wager reversal before its stake — tombstone written');
        return { reversed: false, duplicate: false, tombstone: true };
      }

      const row = await this.models.WagerActivity.findOne({
        where: { source, ref: key },
        transaction,
        lock: transaction.LOCK.UPDATE,
        raw: true,
      });
      const owned = String(row.user_id) === String(userId);
      if (row.reversed_at) {
        // Already fully reversed. Settle the stake's items again (a no-op unless a late side
        // effect slipped past), so a retried call finishes the job.
        if (!owned) return { reversed: false, duplicate: true };
        const figures = stakeFigures(row);
        await this.#settleItems({ userId, source, ref: key, ...figures, transaction });
        return { reversed: false, duplicate: true, figures };
      }
      if (!owned) {
        this.logger?.warn({ userId: String(userId), owner: String(row.user_id), source, ref: key }, 'Wager reversal for another player refused');
        return { reversed: false, duplicate: false, reason: 'USER_MISMATCH' };
      }

      const stake = money.fromStored(String(row.amount ?? '0'));
      const before = money.fromStored(String(row.reversed_amount ?? '0'));
      const left = money.toDecimalString(money.subtract(stake, before));
      if (asked != null && money.gt(asked, stake)) {
        this.logger?.warn({ userId: String(userId), source, ref: key, amount: asked, stake }, 'Wager reversal larger than its stake refused');
        return { reversed: false, duplicate: false, reason: 'EXCEEDS_STAKE' };
      }
      const slice = asked == null || money.gte(asked, left) ? left : asked;
      const after = money.toDecimalString(money.add(before, slice));
      const full = money.gte(after, stake);
      if (!full && !refundKey) return { reversed: false, duplicate: false, reason: 'REFUND_REF_REQUIRED' };

      // The USD that leaves `userwager`: the cumulative share's target minus what already left.
      const usdTotal = money.fromStored(String(row.usd_amount ?? '0'));
      const usd = money.toDecimalString(
        reversedTarget(usdTotal, after, stake, full) - reversedTarget(usdTotal, before, stake, false)
      );

      // Same refund id twice → duplicate (unique `(source, ref, refund_ref)`), nothing moves.
      const logged = await this.#logReversal({ userId, source, key, refundKey, amount: slice, usd, transaction });
      if (!logged) {
        const figures = stakeFigures(row);
        await this.#settleItems({ userId, source, ref: key, ...figures, transaction });
        return { reversed: false, duplicate: true, figures };
      }

      await this.models.WagerActivity.update(
        { reversed_amount: after, ...(full ? { reversed_at: new Date() } : {}) },
        { where: { id: row.id }, transaction }
      );

      const locked = await this.models.Userwager.findOne({
        where: { uid: userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
        raw: true,
      });
      const wagerBefore = cleanWager(locked?.wager);
      let wagerAfter = money.toDecimalString(money.subtract(wagerBefore, usd));
      if (money.lt(wagerAfter, '0')) wagerAfter = ZERO;
      if (locked && wagerAfter !== wagerBefore) {
        await this.models.Userwager.update({ wager: wagerAfter }, { where: { uid: userId }, transaction });
        await this.models.UserwagerHistory.create(
          { uid: userId, previous_wager: wagerBefore, new_wager: wagerAfter, updated_at: new Date() },
          { transaction }
        );
      }

      const figures = { reversedAmount: after, stake, full };
      const { rakebackReversed, commission } = await this.#settleItems({ userId, source, ref: key, ...figures, transaction });

      this.logger?.info(
        { userId: String(userId), source, ref: key, usd, slice, reversedAmount: after, stake, full, rakebackReversed, commission },
        full ? 'Wager reversed' : 'Wager partly reversed'
      );
      return {
        reversed: true,
        duplicate: false,
        partial: !full,
        usdAmount: usd,
        previousWager: wagerBefore,
        newWager: wagerAfter,
        rakebackReversed,
        commissionVoided: commission.voided,
        reversedAmount: after,
        stake,
        figures,
      };
    });
  }

  /** One applied reversal; false when `(source, ref, refundRef)` was already applied. */
  async #logReversal({ userId, source, key, refundKey, amount, usd, transaction }) {
    const rows = await this.db.sequelize.query(
      `INSERT INTO wager_reversals (user_id, source, ref, refund_ref, amount, usd_amount)
       VALUES (:userId, :source, :ref, :refundRef, :amount, :usd)
       ON CONFLICT (source, ref, refund_ref) DO NOTHING
       RETURNING id`,
      {
        replacements: { userId: String(userId), source, ref: key, refundRef: refundKey, amount, usd },
        type: QueryTypes.SELECT,
        transaction,
      }
    );
    return rows.length > 0;
  }

  /**
   * Was this accrual already paid out by a rakeback claim?
   *
   * A claim zeroes `users.rakeamount` but leaves the accrual rows alone, so an
   * accrual made before the player's latest claim is no longer in the balance.
   * Subtracting it anyway would take it out of LATER, unclaimed accruals —
   * clawing back claimed rakeback, which `reverse` promises not to do.
   */
  async #accrualClaimed(userId, accrual, transaction) {
    const lastClaim = await this.models.CreditsLedger?.findOne({
      where: { user_id: String(userId), reason: RAKEBACK_REASON.CLAIM },
      attributes: ['created_at'],
      order: [['created_at', 'DESC']],
      transaction,
      raw: true,
    });
    if (!lastClaim?.created_at || !accrual.created_at) return false;
    return new Date(accrual.created_at).getTime() <= new Date(lastClaim.created_at).getTime();
  }

  async #sideEffects({ userId, previous, next, usd, source, ref, rakeback, stake, code, kind = {} }) {
    const key = String(ref);
    /* Fully reversed between the count and here: nothing below may be written for it.
       (Paid VIP credits are never clawed back, so do not pay any for a stake that is gone.) */
    if ((await this.#reversalState(source, key))?.full) {
      this.logger?.info({ userId: String(userId), source, ref: key }, 'Stake reversed before its side effects — skipped');
      return;
    }

    // Wagering toward the player's active bonuses (the bonus balance's lock), oldest first.
    try {
      await this.#bonuses().onStake({ userId, amount: stake, currency: code, source, ref: key, usd, kind });
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId), source, ref }, 'Bonus wagering progress failed — stake still counted');
    }

    let syncedRate = null;
    try {
      syncedRate = (await this.vip.onWager({ userId, previousWager: previous, newWager: next }))?.rate ?? null;
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId) }, 'VIP on-wager failed — stake still counted');
    }

    try {
      await this.affiliate.onWager({ userId, previousWager: previous, newWager: next, source, ref: key, usd, kind });
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId) }, 'Affiliate on-wager failed — stake still counted');
    }

    /* `onWager` has just synced `users.rakeback` to the card this total is on. A rate of 0 is
       the Unranked card, which earns no rakeback — `accrue` would read that 0 as "not synced
       yet" and pay the Bronze default instead, so an Unranked stake out-earned a Wood one. */
    const unrankedRate = syncedRate != null && !money.gt(String(syncedRate), '0');
    if (rakeback && !unrankedRate) {
      try {
        await this.rakeback.accrue({ userId, stakeUsd: usd, source, ref: key, kind });
      } catch (error) {
        this.logger?.warn({ err: error, userId: String(userId), source, ref }, 'Rakeback accrual failed — stake still counted');
      }
    }

    /* Reversed (in full or in part) while the above was being written? Settle what was just
       written to the reversal's target. Caught: the stake itself stands either way. */
    try {
      const state = await this.#reversalState(source, key);
      if (state && money.gt(state.reversedAmount, '0')) {
        this.logger?.info({ userId: String(userId), source, ref: key, ...state }, 'Stake reversed during its side effects — undoing them');
        await this.db.transaction(async (transaction) => {
          const row = await this.models.WagerActivity.findOne({
            where: { source, ref: key }, transaction, lock: transaction.LOCK.UPDATE, raw: true,
          });
          await this.#settleItems({ userId, source, ref: key, ...stakeFigures(row), transaction });
        });
        await this.#settleBonuses({ userId, source, ref: key, ...state });
        if (state.full) await this.vip.syncRakebackRate?.(userId);
      }
    } catch (error) {
      this.logger?.warn({ err: error, userId: String(userId), source, ref: key }, 'Undoing side effects of a reversed stake failed');
    }
  }

  /** `{ reversedAmount, stake, full }` of a stake now, or null when it has no row. */
  async #reversalState(source, key) {
    const row = await this.models.WagerActivity.findOne({
      where: { source, ref: key },
      attributes: ['amount', 'reversed_amount', 'reversed_at'],
      raw: true,
    });
    return row ? stakeFigures(row) : null;
  }

  /** Bonus wagering allocations of a stake → its target (own transaction; idempotent). */
  async #settleBonuses({ userId, source, ref, reversedAmount, stake, full }) {
    return this.#bonuses().onReverse({ userId, source, ref: String(ref), reversedAmount, stake, full });
  }

  /**
   * The stake's rakeback accrual and affiliate commission → their pro-rated target, inside
   * the caller's transaction (which holds the `wager_activity` row lock).
   *
   * Lock order: the `users` row BEFORE the accrual — the order `rakeback.accrue` and
   * `rakeback.claim` take them in — so a reversal and an accrual/claim for the same player
   * serialise instead of deadlocking, and the accrual is read after any in-flight accrual
   * for it has committed.
   *
   * Already-claimed rakeback and commission are not clawed back (documented rule).
   */
  async #settleItems({ userId, source, ref, reversedAmount, stake, full, transaction }) {
    const key = String(ref);
    let rakebackReversed = ZERO;

    await this.models.Users.findOne({
      where: { id: userId }, attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE, raw: true,
    });
    const accrual = await this.models.RakebackAccrual?.findOne({
      where: { source, ref: key },
      transaction,
      lock: transaction.LOCK.UPDATE,
      raw: true,
    });
    if (accrual && money.gt(String(accrual.amount ?? '0'), '0') && !(await this.#accrualClaimed(userId, accrual, transaction))) {
      const next = settleItem(accrual, { reversedStake: reversedAmount, stake, full });
      if (next) {
        rakebackReversed = next.delta;
        await this.models.RakebackAccrual.update(
          { amount: next.amount, reversed_amount: next.reversed },
          { where: { id: accrual.id }, transaction }
        );
        await this.models.Users.update(
          { rakeamount: literal(`GREATEST(COALESCE(rakeamount, 0) - ${rakebackReversed}, 0)`) },
          { where: { id: userId }, transaction }
        );
      }
    }

    let commission = { voided: [], reduced: [] };
    if (typeof this.affiliate.onReverse === 'function') {
      commission = await this.affiliate.onReverse({ source, ref: key, reversedAmount, stake, full, transaction });
    }
    return { rakebackReversed, commission };
  }
}

/** The stake's figures as the pro-rating rule reads them. */
function stakeFigures(row) {
  const stake = money.fromStored(String(row?.amount ?? '0'));
  const reversedAmount = money.fromStored(String(row?.reversed_amount ?? '0'));
  const full = Boolean(row?.reversed_at) || (money.gt(stake, '0') && money.gte(reversedAmount, stake));
  return { stake, reversedAmount, full };
}

/** `userwager.wager` is TEXT and legacy rows carry thousands separators. */
/**
 * The `wager_activity` columns that say what kind of bet this was (migration 132). A missing
 * category comes from the settlement path (`inhouse` → originals, `sports` → sports) or is slots;
 * a missing house edge is the category's default (`wagerCategory.DEFAULT_HOUSE_EDGE`).
 */
function describeStake({ category, source, provider, gameRef, odds, houseEdge }) {
  const resolved = wagerCategory.resolveCategory({ category, source });
  return {
    category: resolved,
    provider: provider || null,
    game_ref: gameRef || null,
    odds: odds || null,
    house_edge: houseEdge ?? wagerCategory.DEFAULT_HOUSE_EDGE[resolved],
  };
}

function cleanWager(value) {
  const cleaned = value == null ? '0' : String(value).replace(/,/g, '').trim();
  return /^\d+(\.\d+)?$/.test(cleaned) ? money.toDecimalString(money.toMinorQuantised(cleaned)) : '0.00000000';
}

module.exports = { describeStake, WagerActivityService, USD_CURRENCIES, cleanWager };