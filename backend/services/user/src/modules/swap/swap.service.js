'use strict';

const { money } = require('@ibitplay/common');

const errors = require('./swap.errors');
const { feeRateFor } = require('./swap.constants');
const { WalletRepository } = require('../wallet/wallet.repository');
const { ExchangeRateService } = require('../exchange-rate/exchangeRate.service');
const { REASON } = require('../wallet/wallet.constants');

/**
 * Internal currency swap.
 *
 * A swap is two balance changes in one transaction: debit the source currency,
 * credit the target. Both legs take the wallet row lock, both are guarded, and
 * both are recorded — a swap that half-applied would be a balance appearing
 * from nowhere or vanishing into it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this replaces
 *
 * `legacy/internalswap/controller.js` built its SQL by string interpolation
 * from request input:
 *
 *   const balanceQuery = `SELECT ${fromCurrency.toLowerCase()} as from_balance ... `;
 *   const updateQuery  = `UPDATE credits
 *                            SET ${fromCurrency.toLowerCase()} = ${...} - $1,
 *                                ${toCurrency.toLowerCase()}   = ${...} + $2
 *                          WHERE uid = $3`;
 *
 * `fromCurrency` came straight from `req.body` with no validation, and the
 * route had no authentication. That is arbitrary SQL execution against the
 * table holding every player balance, reachable by anyone who could send a
 * POST. It is the most serious defect found anywhere in the legacy codebase.
 *
 * Here the currency is checked against a fixed allow-list before it can become
 * a column name (`wallet.constants.resolveColumn`), the route requires a player
 * token, and the uid comes from that token rather than the body — so a player
 * can only ever swap their own funds.
 *
 * The arithmetic was also all JS floats: `amount * feePercentage`, then
 * `usdAmount / rates[...]`. Both now run in BigInt minor units.
 * ─────────────────────────────────────────────────────────────────────────
 */
class SwapService {
  constructor(deps) {
    const { models, db, config, logger } = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = new WalletRepository({ models, db });
    this.rates = new ExchangeRateService(deps);
  }

  /**
   * What a swap would produce, without performing it.
   *
   * @legacy GET /internalswap/estimate
   */
  async estimate({ fromCurrency, toCurrency, amount }) {
    if (fromCurrency === toCurrency) throw errors.SAME_CURRENCY({ currency: fromCurrency });

    const quote = await this.#quote({ fromCurrency, toCurrency, amount });

    return {
      fromCurrency,
      toCurrency,
      amount: money.toDecimalString(money.toMinor(amount)),
      feePercentage: quote.feeRate,
      feeAmount: money.toDecimalString(quote.feeAmount),
      amountAfterFee: money.toDecimalString(quote.afterFee),
      converted: money.toDecimalString(quote.converted),
      usdRateFrom: quote.fromRate,
      usdRateTo: quote.toRate,
    };
  }

  /**
   * Perform the swap.
   *
   * @legacy POST /internalswap/swap
   */
  async swap({ userId, fromCurrency, toCurrency, amount }) {
    if (fromCurrency === toCurrency) throw errors.SAME_CURRENCY({ currency: fromCurrency });

    const quote = await this.#quote({ fromCurrency, toCurrency, amount });

    return this.db.transaction(async (transaction) => {
      // One lock covers both currencies: they are columns on the same row.
      const locked = await this.wallet.lockBalance(userId, fromCurrency, transaction);
      if (!locked) throw errors.INSUFFICIENT_BALANCE({ currency: fromCurrency, available: '0', requested: amount });

      const fromBefore = money.fromStored(locked.balance);

      // The full amount leaves the wallet — the fee is retained by the house,
      // only the post-fee remainder is converted.
      const debit = await this.wallet.debit(userId, fromCurrency, amount, transaction);
      if (!debit.ok) {
        throw errors.INSUFFICIENT_BALANCE({
          currency: fromCurrency,
          requested: money.toDecimalString(money.toMinor(amount)),
          available: fromBefore,
        });
      }

      const toLocked = await this.wallet.lockBalance(userId, toCurrency, transaction);
      const toBefore = money.fromStored(toLocked?.balance ?? '0');

      const convertedString = money.toDecimalString(quote.converted);
      const toAfter = await this.wallet.credit(userId, toCurrency, convertedString, transaction);

      // Both legs on the ledger, so summing it still reconciles per currency.
      const outLedger = await this.wallet.writeLedger(
        {
          user_id: String(userId),
          currency: fromCurrency,
          amount: money.toDecimalString(-money.toMinor(amount)),
          reason: REASON.TRANSFER_OUT,
          description: `Swap ${fromCurrency} -> ${toCurrency}`,
          balance: money.fromStored(debit.balance),
          closing: money.fromStored(debit.balance),
          source_service: 'user-service',
          meta: { swap: true, toCurrency, feeAmount: money.toDecimalString(quote.feeAmount), previousBalance: fromBefore },
        },
        transaction
      );

      const inLedger = await this.wallet.writeLedger(
        {
          user_id: String(userId),
          currency: toCurrency,
          amount: convertedString,
          reason: REASON.TRANSFER_IN,
          description: `Swap ${fromCurrency} -> ${toCurrency}`,
          balance: money.fromStored(toAfter),
          closing: money.fromStored(toAfter),
          source_service: 'user-service',
          meta: { swap: true, fromCurrency, swapOutLedgerId: outLedger.id, previousBalance: toBefore },
        },
        transaction
      );

      const history = await this.models.SwapHistory.create(
        {
          uid: userId,
          from_currency: fromCurrency,
          to_currency: toCurrency,
          from_amount: money.toDecimalString(money.toMinor(amount)),
          to_amount: convertedString,
          fee_percentage: quote.feeRate,
          fee_amount: money.toDecimalString(quote.feeAmount),
          fee_currency: fromCurrency,
          usd_rate_from: quote.fromRate,
          usd_rate_to: quote.toRate,
        },
        { transaction }
      );

      return {
        swapId: history.id,
        fromCurrency,
        toCurrency,
        fromAmount: money.toDecimalString(money.toMinor(amount)),
        toAmount: convertedString,
        feePercentage: quote.feeRate,
        feeAmount: money.toDecimalString(quote.feeAmount),
        amountAfterFee: money.toDecimalString(quote.afterFee),
        newBalances: {
          [fromCurrency]: money.fromStored(debit.balance),
          [toCurrency]: money.toDecimalString(money.toMinor(toAfter)),
        },
        ledger: { out: outLedger.id, in: inLedger.id },
      };
    });
  }

  /** @legacy GET /internalswap/balances/:uid */
  async getBalances(userId) {
    const wallet = await this.wallet.findWallet(userId);
    if (!wallet) return {};

    const { uid, ...balances } = wallet;
    return Object.fromEntries(
      Object.entries(balances)
        .map(([code, value]) => [code.toUpperCase(), money.toDecimalString(money.toMinor(value ?? '0'))])
        // A swap screen only needs the currencies the player actually holds.
        .filter(([, value]) => money.gt(value, '0'))
    );
  }

  /** @legacy GET /internalswap/history/:uid */
  async listUserHistory({ userId, limit, offset }) {
    return this.models.SwapHistory.findAndCountAll({
      where: { uid: userId },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /** @legacy GET /internalswap/history */
  async listAllHistory({ userId, limit, offset }) {
    return this.models.SwapHistory.findAndCountAll({
      where: userId ? { uid: userId } : undefined,
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /**
   * Price the swap: fee, then convert the remainder through USD.
   *
   * Every step is BigInt minor units. The order matters and matches legacy —
   * the fee comes off BEFORE conversion, so the player pays the fee in the
   * source currency.
   */
  async #quote({ fromCurrency, toCurrency, amount }) {
    const feeRate = feeRateFor(fromCurrency);

    // percentOf works at scale 8, so a 0.15 rate is exact rather than 0.1499999.
    const feeAmount = money.percentOf(amount, money.toDecimalString(money.multiply(feeRate, '100')));
    const afterFee = money.subtract(amount, money.toDecimalString(feeAmount));

    // Both rates are needed anyway — they are recorded on the swap history row
    // so a historical swap can be re-derived — so fetch them once and convert
    // from them, rather than converting and then re-reading them.
    let fromRate;
    let toRate;
    try {
      [fromRate, toRate] = await Promise.all([
        this.#rateOf(fromCurrency),
        this.#rateOf(toCurrency),
      ]);
    } catch (error) {
      if (error.code === 'EXCHANGE_RATE_RATE_NOT_FOUND') {
        throw errors.RATE_UNAVAILABLE({ fromCurrency, toCurrency });
      }
      throw error;
    }

    // afterFee -> USD -> target, in BigInt minor units throughout.
    const usdValue = money.multiply(money.toDecimalString(afterFee), fromRate);
    const converted = money.divide(money.toDecimalString(usdValue), toRate);

    // A swap that rounds to zero takes the input and returns nothing. Refuse it
    // rather than let the player lose the amount — legacy had no such check.
    if (converted <= 0n) {
      throw errors.AMOUNT_TOO_SMALL({
        fromCurrency,
        toCurrency,
        amount: money.toDecimalString(money.toMinor(amount)),
        wouldReceive: money.toDecimalString(converted),
      });
    }

    return { feeRate, feeAmount, afterFee, converted, usdValue, fromRate, toRate };
  }

  async #rateOf(currency) {
    const { usdRate } = await this.rates.getRate(currency);
    return usdRate;
  }
}

module.exports = { SwapService };
