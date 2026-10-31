'use strict';

const { Op, literal, QueryTypes } = require('sequelize');
const { money, currencyRegistry, directLedger } = require('@ibitplay/common');
const { assertPlayerCapability } = require('@ibitplay/auth');

const errors = require('./swap.errors');
const { FEE_BY_CURRENCY, DEFAULT_FEE, FEE_CONFIG_KEY } = require('./swap.constants');
const { WalletRepository } = require('../wallet/wallet.repository');
const { ExchangeRateService } = require('../exchange-rate/exchangeRate.service');
const { REASON, CURRENCY_COLUMN } = require('../wallet/wallet.constants');
const { ownerWhere, assertPlayerVisible, withChannel } = require('../directory/playerScope');

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
    const { models, db, config, logger, clients } = deps;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
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
    // Agent-tree players cannot swap (SWAP_NOT_FOR_AGENT_USERS). The HTTP route
    // refuses them first; this covers every other caller — the
    // SUBMIT_NEW_SWAP socket in particular.
    await assertPlayerCapability(userId, 'swap');
    if (fromCurrency === toCurrency) throw errors.SAME_CURRENCY({ currency: fromCurrency });
    // A coin switched off by the owner or the site (built-in or custom, 065)
    // is not a swap target; a balance in one can still be swapped OUT.
    if (!(await currencyRegistry.isEnabled(toCurrency))) {
      throw errors.CURRENCY_DISABLED({ currency: toCurrency });
    }

    const quote = await this.#quote({ fromCurrency, toCurrency, amount });

    return this.db.transaction(async (transaction) => {
      // One lock covers both currencies: they are columns on the same row.
      const locked = await this.wallet.lockBalance(userId, fromCurrency, transaction);
      if (!locked) throw errors.INSUFFICIENT_BALANCE({ currency: fromCurrency, available: '0', requested: amount });

      const fromBefore = money.fromStored(locked.balance);

      // The full amount leaves the wallet — the fee is retained by the house,
      // only the post-fee remainder is converted.
      // Each update names itself on the direct player's statement (a bare update reads BALANCE_CHANGE).
      const label = { userId, eventType: 'SWAP', category: directLedger.CATEGORY.TRANSFER, source: 'user-service', remark: `Swap ${fromCurrency} -> ${toCurrency}` };
      await directLedger.directLedgerContext(this.db.sequelize, transaction, label);
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
      await directLedger.directLedgerContext(this.db.sequelize, transaction, label);
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
          [toCurrency]: money.fromStored(toAfter),
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
    const custom = await this.wallet.listCustomBalances(userId);
    return Object.fromEntries(
      [
        ...Object.entries(balances)
          // Coin columns only (`credits` also carries `credit_limit`).
          .filter(([column]) => Object.prototype.hasOwnProperty.call(CURRENCY_COLUMN, column.toUpperCase()))
          .map(([code, value]) => [code.toUpperCase(), money.fromStored(value ?? '0')]),
        // Custom coins (065), from `wallet_balances`.
        ...custom.map((row) => [row.code, money.fromStored(row.balance ?? '0')]),
      ]
        // A swap screen only needs the currencies the player actually holds.
        .filter(([, value]) => money.gt(value, '0'))
    );
  }

  /** @legacy GET /internalswap/history/:uid */
  /** One player's swaps, for a staff caller — the player must be in their tree. */
  async listUserHistoryForStaff({ staff, userId, limit, offset }) {
    await assertPlayerVisible(this, staff?.id, userId);
    return this.listUserHistory({ userId, limit, offset });
  }

  async listUserHistory({ userId, limit, offset }) {
    return this.models.SwapHistory.findAndCountAll({
      where: { uid: userId },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /**
   * @legacy GET /internalswap/history
   *
   * Scoped to the caller's tree — this listed every player's swaps to any
   * staff member with `wallet:read`, agents included.
   */
  /** The swap fee every live coin pays, as a fraction ("0.01" is 1%): the Super Admin's, or the default. */
  async getFee() {
    const [row] = await this.db.sequelize.query('SELECT config_value FROM admin_configurations WHERE config_key = :key', {
      replacements: { key: FEE_CONFIG_KEY },
      type: QueryTypes.SELECT,
    });
    return { fee: row?.config_value ?? DEFAULT_FEE };
  }

  /** Sets the swap fee for every swap from now on; past swaps keep the fee stored on their row. */
  async setFee({ fee }) {
    await this.db.sequelize.query(
      `INSERT INTO admin_configurations (config_key, config_value, last_updated) VALUES (:key, :fee, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, last_updated = NOW()`,
      { replacements: { key: FEE_CONFIG_KEY, fee } },
    );
    return this.getFee();
  }

  /**
   * What the swap fees earned, in USDT: each fee at the USD rate its own swap used (USDT is 1 USD).
   * The caller's tree, direct users by default (agent-tree players cannot swap).
   */
  async feeSummary({ staff, userId, channel = 'direct' }) {
    const where = withChannel(await ownerWhere(this, staff?.id, 'uid', userId), 'uid', channel);
    const fee = 'fee_amount * COALESCE(usd_rate_from, 0)';
    const sum = (filter) => literal(`ROUND(COALESCE(SUM(${fee})${filter ? ` FILTER (WHERE ${filter})` : ''}, 0), 8)::text`);
    const [row] = await this.models.SwapHistory.findAll({
      where,
      attributes: [
        [literal('COUNT(*)::int'), 'swaps'],
        [sum(null), 'feeUsdt'],
        [sum("created_at >= date_trunc('day', NOW())"), 'todayUsdt'],
        [sum("created_at >= date_trunc('month', NOW())"), 'monthUsdt'],
      ],
      raw: true,
    });
    return { swaps: row?.swaps ?? 0, feeUsdt: row?.feeUsdt ?? '0', todayUsdt: row?.todayUsdt ?? '0', monthUsdt: row?.monthUsdt ?? '0' };
  }

  /**
   * The fee earnings day by day, newest first: swaps, the value swapped and the fee in USDT (each at
   * its own swap's rate), and the fee as taken, coin by coin.
   */
  async feeHistory({ staff, userId, channel = 'direct', limit, offset }) {
    const where = withChannel(await ownerWhere(this, staff?.id, 'uid', userId), 'uid', channel);
    const day = literal("date_trunc('day', created_at)");
    const [rows, total] = await Promise.all([
      this.models.SwapHistory.findAll({
        where,
        attributes: [
          [literal("to_char(date_trunc('day', created_at), 'YYYY-MM-DD')"), 'day'],
          [literal('COUNT(*)::int'), 'swaps'],
          [literal('ROUND(COALESCE(SUM(fee_amount * COALESCE(usd_rate_from, 0)), 0), 8)::text'), 'feeUsdt'],
          [literal('ROUND(COALESCE(SUM(from_amount * COALESCE(usd_rate_from, 0)), 0), 8)::text'), 'volumeUsdt'],
        ],
        group: [day],
        order: [[day, 'DESC']],
        limit,
        offset,
        raw: true,
      }),
      this.models.SwapHistory.findAll({ where, attributes: [[literal("COUNT(DISTINCT date_trunc('day', created_at))::int"), 'n']], raw: true }),
    ]);
    // The same days' fees per coin, as the player paid them.
    const coins = rows.length
      ? await this.models.SwapHistory.findAll({
          where: { ...where, [Op.and]: [...(where[Op.and] ?? []), literal(`to_char(date_trunc('day', created_at), 'YYYY-MM-DD') IN (${rows.map((r) => `'${r.day}'`).join(',')})`)] },
          attributes: [
            [literal("to_char(date_trunc('day', created_at), 'YYYY-MM-DD')"), 'day'],
            'fee_currency',
            [literal('ROUND(SUM(fee_amount), 8)::text'), 'fee'],
          ],
          group: [day, 'fee_currency'],
          raw: true,
        })
      : [];
    return {
      rows: rows.map((r) => ({ ...r, fees: coins.filter((c) => c.day === r.day).map((c) => ({ currency: c.fee_currency, amount: c.fee })) })),
      count: total[0]?.n ?? 0,
    };
  }

  async listAllHistory({ staff, userId, currency, channel, limit, offset }) {
    const where = withChannel(await ownerWhere(this, staff?.id, 'uid', userId), 'uid', channel);
    // The site admin's currency filter: a swap out of OR into that coin.
    if (currency) where[Op.or] = [{ from_currency: currency }, { to_currency: currency }];
    return this.models.SwapHistory.findAndCountAll({
      where,
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
    const feeRate = FEE_BY_CURRENCY[String(fromCurrency).toUpperCase()] ?? (await this.getFee()).fee;

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
