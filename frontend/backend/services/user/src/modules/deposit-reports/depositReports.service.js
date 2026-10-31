'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./depositReports.errors');
const { SOURCES, statusBucket, BUCKET } = require('./depositReports.constants');

/**
 * Staff deposit reporting — crypto and fiat, listed and totalled.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THREE THINGS THE LEGACY VERSION GOT WRONG
 *
 * 1. THE SCOPE CAME FROM A HEADER.
 *
 *      const ids = await visibleIds(req.headers['x-staff-id'])
 *
 *    On an unauthenticated route. `x-staff-id: 1` is the platform owner, and
 *    the query then returns every deposit made by every player. The header was
 *    never checked against a token, because there was no token.
 *
 *    Here the id comes from a verified staff token, and the tree is resolved by
 *    admin-service — which owns `staff` — over the internal API.
 *
 * 2. MONEY WAS CAST TO `::float`.
 *
 *    Every total in these reports was computed in binary floating point. For
 *    reporting that is not merely imprecise, it is unstable: the same query run
 *    over the same rows in a different order gives a different last digit, and
 *    a reconciliation against the ledger never quite balances. Totals are
 *    accumulated here as exact decimals.
 *
 * 3. A MISSING EXCHANGE RATE SILENTLY BECAME 0.012.
 *
 *      return Number.isFinite(rate) && rate > 0 ? rate : 0.012;
 *
 *    A hard-coded ~₹83/USD, applied without comment if the `exchangerate` row
 *    was missing or null. The report still rendered, still looked right, and was
 *    wrong by however much the real rate had moved. A missing rate is now a 503.
 * ─────────────────────────────────────────────────────────────────────────
 */
class DepositReportsService {
  constructor({ models, logger, clients, config }) {
    this.models = models;
    this.logger = logger;
    this.clients = clients;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Crypto
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /depositHistory/crypto/deposits */
  async listCryptoDeposits({ staff, status, from, to, userId, chain, limit = 10, offset = 0 }) {
    const where = await this.#cryptoScope(staff, { status, from, to, userId, chain });
    const rate = await this.#inrPerUsd();

    const { rows, count } = await this.models.Ccdeposit.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((row) => ({
        id: row.id,
        userId: row.userid,
        chain: row.chain,
        orderId: row.orderid,
        address: row.deposit_address,
        status: row.status,
        // `ccdeposit.amount` is USD (USDT ≈ USD). Both figures are returned:
        // the original is what the chain actually moved, and rounding it away
        // makes a support query unanswerable.
        amountUsd: money.toDecimalString(money.toMinor(row.amount ?? '0')),
        amountInr: money.toDecimalString(money.multiply(row.amount ?? '0', rate)),
        createdAt: row.created_at,
      })),
      rateUsdToInr: rate,
    };
  }

  /** @legacy GET /depositHistory/crypto/stats */
  async cryptoStats({ staff, from, to }) {
    const where = await this.#cryptoScope(staff, { from, to });
    const rate = await this.#inrPerUsd();

    const grouped = await this.models.Ccdeposit.findAll({
      where,
      attributes: [
        [fn('LOWER', col('status')), 'status'],
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('amount')), 'amount'],
      ],
      group: [literal('LOWER(status)')],
      raw: true,
    });

    return this.#summarise(grouped, (usd) => money.toDecimalString(money.multiply(usd, rate)), 'INR');
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Fiat
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /depositHistory/fiat/deposits
   *
   * Four provider tables, presented as one list.
   *
   * Legacy did this with a `UNION ALL` of four SELECTs, each casting
   * `currency::text` and `status::text` because the four tables disagree on
   * both types — with a comment explaining that without the casts Postgres
   * cannot infer the parameter types. That is a lot of machinery to paper over
   * four tables that should have been one.
   *
   * Here each table is queried through its own model and the results are merged.
   * More round trips, but every one of them is an indexed, bounded query, and
   * the shape difference is handled in JavaScript where it can be read.
   */
  async listFiatDeposits({ staff, status, from, to, userId, currency, provider, limit = 10, offset = 0 }) {
    const visibleUserIds = await this.#visibleUserIds(staff);
    const sources = provider ? SOURCES.filter((s) => s.provider === provider) : SOURCES;

    const batches = await Promise.all(
      sources.map(async (source) => {
        const where = this.#fiatScope(source, { status, from, to, userId, currency, visibleUserIds });
        if (where === null) return [];

        const rows = await this.models[source.model].findAll({
          where,
          order: [['created_at', 'DESC']],
          // Each source is capped at what the caller could possibly page to, so
          // one busy provider cannot starve the others out of the result.
          limit: limit + offset,
          raw: true,
        });

        return rows.map((row) => ({
          provider: source.provider,
          id: row[source.idColumn],
          userId: row[source.userColumn],
          reference: row[source.referenceColumn] ?? null,
          amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
          currency: source.currency ?? row.currency ?? 'INR',
          status: statusBucket(source.provider, row.status),
          rawStatus: row.status,
          createdAt: row.created_at,
        }));
      })
    );

    const merged = batches.flat().sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

    return { total: merged.length, rows: merged.slice(offset, offset + limit) };
  }

  /** @legacy GET /depositHistory/fiat/stats */
  async fiatStats({ staff, from, to, currency }) {
    const visibleUserIds = await this.#visibleUserIds(staff);

    // Only converted when reporting across currencies. Asking for one currency
    // reports in that currency untouched — converting and back is a rounding
    // step that buys nothing.
    const rates = currency ? null : await this.#usdRates();

    const totals = {
      totalTransactions: 0,
      totalAmount: '0',
      successfulAmount: '0',
      processingAmount: '0',
      successfulTransactions: 0,
      processingTransactions: 0,
      failedTransactions: 0,
      currency: currency || 'INR',
      byProvider: {},
    };

    for (const source of SOURCES) {
      const where = this.#fiatScope(source, { from, to, currency, visibleUserIds });
      if (where === null) continue;

      const rows = await this.models[source.model].findAll({
        where,
        attributes: [
          'status',
          ...(source.currency ? [] : ['currency']),
          [fn('COUNT', col(source.idColumn)), 'count'],
          [fn('SUM', col('amount')), 'amount'],
        ],
        group: source.currency ? ['status'] : ['status', 'currency'],
        raw: true,
      });

      for (const row of rows) {
        const rowCurrency = source.currency ?? row.currency ?? 'INR';
        const bucket = statusBucket(source.provider, row.status);
        const count = Number(row.count ?? 0);
        const amount = this.#toReportingCurrency(row.amount ?? '0', rowCurrency, rates, currency);

        totals.totalTransactions += count;
        totals.totalAmount = money.toDecimalString(money.add(totals.totalAmount, amount));

        if (bucket === BUCKET.SUCCESS) {
          totals.successfulTransactions += count;
          totals.successfulAmount = money.toDecimalString(money.add(totals.successfulAmount, amount));
        } else if (bucket === BUCKET.PENDING) {
          totals.processingTransactions += count;
          totals.processingAmount = money.toDecimalString(money.add(totals.processingAmount, amount));
        } else if (bucket === BUCKET.FAILED) {
          totals.failedTransactions += count;
        }

        const per = (totals.byProvider[source.provider] ??= { count: 0, amount: '0' });
        per.count += count;
        per.amount = money.toDecimalString(money.add(per.amount, amount));
      }
    }

    return totals;
  }


  // ══════════════════════════════════════════════════════════════════════
  //  Profit and loss
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/deposit/user-pl
   *
   * What one player is worth to the house.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE LEGACY CALCULATION WAS NOT PROFIT AND LOSS
   *
   *     const profitLoss = totalDeposits - totalWithdrawals;
   *
   * It ignores the money the player is still holding. Somebody who deposited
   * 1,000, withdrew nothing, and has 1,000 sitting in their balance showed a
   * "profit" of 1,000 — for a house that has made nothing and owes all of it
   * back. Every figure on that screen was overstated by the outstanding
   * liability, and most overstated for the players who had just deposited.
   *
   * What the house has actually made is:
   *
   *     deposits − withdrawals − whatever the player can still withdraw
   *
   * ── AND IT COUNTED ONE SOURCE OF FOUR ────────────────────────────────
   *
   * `totalDeposits` came only from `staff_transfers` — money an agent handed
   * over. A player who funded their account through UPI, A-Pay, CricPay,
   * WayPay or on-chain showed zero deposits and therefore a P&L equal to minus
   * their withdrawals. Every gateway is counted here.
   * ─────────────────────────────────────────────────────────────────────
   */
  async userProfitLoss({ staff, userId }) {
    const visible = await this.#visibleUserIds(staff);
    if (!visible.map(String).includes(String(userId))) throw errors.NOT_IN_SCOPE({ userId });

    const [staffDeposits, fiatDeposits, cryptoDeposits, withdrawals, balances] = await Promise.all([
      this.#sum(this.models.StaffTransfers, {
        to_type: 'user', to_id: userId, direction: 'deposit',
      }, 'amount'),
      this.#sum(this.models.FiatDeposits, { user_id: String(userId), status: 'approved' }, 'amount'),
      this.#sum(this.models.Deposits, { uid: userId }, 'amount'),
      this.#sum(this.models.FiatWithdrawals, { uid: userId, status: 'Approved' }, 'amount'),
      this.models.Credits.findOne({ where: { uid: userId }, raw: true }),
    ]);

    const deposited = [staffDeposits, fiatDeposits, cryptoDeposits].reduce(
      (sum, v) => money.add(sum, money.toMinor(v)),
      money.toMinor('0')
    );
    const held = money.toMinorQuantised(balances?.inr ?? '0');
    const withdrawn = money.toMinor(withdrawals);

    return {
      userId: Number(userId),
      deposits: {
        total: money.toDecimalString(deposited),
        // Broken out, because "the agent gave them 500" and "they paid by UPI"
        // are different businesses and legacy reported only the first.
        fromStaff: money.toDecimalString(money.toMinor(staffDeposits)),
        fiatGateway: money.toDecimalString(money.toMinor(fiatDeposits)),
        crypto: money.toDecimalString(money.toMinor(cryptoDeposits)),
      },
      withdrawals: money.toDecimalString(withdrawn),
      // What they could still take out. Legacy left this out entirely.
      outstanding: money.toDecimalString(held),
      profitLoss: money.toDecimalString(
        money.subtract(money.subtract(deposited, withdrawn), held)
      ),
      currency: 'INR',
    };
  }

  /**
   * @legacy POST /api/deposit/staff-pl
   *
   * The same figure for a staff account and everything under it.
   *
   * Legacy summed only `staff_transfers` into that one account — so an agent's
   * P&L excluded every player beneath them, which is the entire point of the
   * number.
   */
  async staffProfitLoss({ staff, staffId }) {
    const visibleStaff = await this.#visibleStaffIds(staff);
    if (!visibleStaff.map(String).includes(String(staffId))) throw errors.NOT_IN_SCOPE({ staffId });

    const players = await this.models.Users.findAll({
      where: { parent_staff_id: staffId },
      attributes: ['id'],
      raw: true,
    });

    const perPlayer = await Promise.all(
      players.map((p) => this.userProfitLoss({ staff, userId: p.id }))
    );

    const total = perPlayer.reduce(
      (sum, p) => money.add(sum, money.toMinor(p.profitLoss)),
      money.toMinor('0')
    );

    return {
      staffId: Number(staffId),
      players: players.length,
      profitLoss: money.toDecimalString(total),
      currency: 'INR',
    };
  }

  /** Sum one column as exact decimals. Legacy used `parseFloat` on every one. */
  async #sum(model, where, column) {
    if (!model) return '0';
    const rows = await model.findAll({
      attributes: [[fn('COALESCE', fn('SUM', col(column)), 0), 'total']],
      where,
      raw: true,
    });
    return String(rows[0]?.total ?? '0');
  }

  /** The staff accounts this caller may report on. */
  async #visibleStaffIds(staff) {
    try {
      const result = await this.clients.admin.get(
        `/internal/admin/staff-directory/staff/${staff.id}/descendants`
      );
      const ids = result?.ids ?? result?.data?.ids;
      if (!Array.isArray(ids) || !ids.length) throw errors.VISIBILITY_UNAVAILABLE();
      return ids;
    } catch (error) {
      if (error?.code === 'DEPREPORT_VISIBILITY_UNAVAILABLE') throw error;
      this.logger?.error({ err: error, staffId: staff?.id }, 'Could not resolve the staff reporting scope');
      throw errors.VISIBILITY_UNAVAILABLE();
    }
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Which staff accounts this caller may report on, and therefore which players.
   *
   * The platform owner (staff id 1, or anyone whose tree contains it) also sees
   * players with no assigned staff — `parent_staff_id IS NULL` — which is what
   * the legacy query did and is the difference between "my agents' players" and
   * "everyone".
   */
  async #visibleUserIds(staff) {
    let staffIds;
    try {
      const result = await this.clients.admin.get(
        `/internal/admin/staff-directory/staff/${staff.id}/descendants`
      );
      staffIds = result?.ids ?? result?.data?.ids;
    } catch (error) {
      this.logger?.error({ err: error, staffId: staff.id }, 'Could not resolve the staff reporting scope');
      throw errors.VISIBILITY_UNAVAILABLE();
    }

    if (!Array.isArray(staffIds) || !staffIds.length) throw errors.VISIBILITY_UNAVAILABLE();

    const includeUnassigned = staffIds.map(Number).includes(1);

    const users = await this.models.Users.findAll({
      where: includeUnassigned
        ? { [Op.or]: [{ parent_staff_id: staffIds }, { parent_staff_id: null }] }
        : { parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });

    return users.map((u) => u.id);
  }

  /** Crypto deposits key their user column as TEXT — see paymentOrders.constants. */
  async #cryptoScope(staff, { status, from, to, userId, chain } = {}) {
    const visible = await this.#visibleUserIds(staff);

    const where = { userid: visible.map(String) };

    if (userId) where.userid = String(userId);
    if (status) where.status = status;
    if (chain) where.chain = chain;
    Object.assign(where, this.#dateRange(from, to));

    return where;
  }

  /**
   * Scope one fiat source.
   *
   * Returns null when the filters exclude this source entirely — asking for
   * BDT excludes CricPay, which is INR-only, and running the query anyway
   * would return rows that do not match the filter.
   */
  #fiatScope(source, { status, from, to, userId, currency, visibleUserIds }) {
    if (currency && source.currency && source.currency !== currency) return null;

    const where = {};

    where[source.userColumn] = source.userIdIsText
      ? (userId ? String(userId) : visibleUserIds.map(String))
      : (userId ?? visibleUserIds);

    if (currency && !source.currency) where.currency = currency;

    if (status) {
      const values = source.statusValues?.[status];
      // A status this source cannot express excludes it, rather than matching
      // nothing and looking like an empty day.
      if (!values) return null;
      where.status = values;
    }

    Object.assign(where, this.#dateRange(from, to));
    return where;
  }

  /**
   * A half-open range: `>= from` and `< to + 1 day`.
   *
   * Not `BETWEEN`. `created_at <= '2026-08-03'` compares a timestamp against
   * midnight, so every deposit made during the end date itself is excluded —
   * which the legacy version did, quietly losing a day off the end of every
   * report.
   */
  #dateRange(from, to) {
    if (!from && !to) return {};

    const range = {};
    if (from) range[Op.gte] = new Date(from);
    if (to) {
      const end = new Date(to);
      if (from && end < new Date(from)) throw errors.INVALID_DATE_RANGE({ from, to });
      end.setUTCDate(end.getUTCDate() + 1);
      range[Op.lt] = end;
    }
    return { created_at: range };
  }

  /** How many INR one USD buys. A missing rate is an error, not a guess. */
  async #inrPerUsd() {
    const row = await this.models.Exchangerate.findOne({ where: { currency: 'INR' }, raw: true });
    const usdPerInr = Number(row?.usd_rate);

    if (!Number.isFinite(usdPerInr) || usdPerInr <= 0) {
      this.logger?.error('No usable INR exchange rate — refusing to report converted totals');
      throw errors.RATE_UNAVAILABLE({ currency: 'INR' });
    }

    // `usd_rate` is USD per 1 unit of the currency, so 1 INR ≈ 0.0108 USD.
    // Inverting gives INR per USD.
    return money.toDecimalString(money.divide('1', String(usdPerInr)));
  }

  /** Every currency's USD rate, for the cross-currency total. */
  async #usdRates() {
    const rows = await this.models.Exchangerate.findAll({ raw: true });
    const rates = new Map();
    for (const row of rows) {
      const rate = Number(row.usd_rate);
      if (Number.isFinite(rate) && rate > 0) rates.set(String(row.currency).toUpperCase(), String(row.usd_rate));
    }
    if (!rates.has('INR')) throw errors.RATE_UNAVAILABLE({ currency: 'INR' });
    return rates;
  }

  /**
   * Convert one figure into the reporting currency.
   *
   * A currency with no rate contributes ZERO and is logged. Legacy did the same
   * (`ELSE 0`) but silently — so an unpriced currency vanished from the totals
   * with nothing to say it had.
   */
  #toReportingCurrency(amount, rowCurrency, rates, requestedCurrency) {
    if (requestedCurrency) return money.toDecimalString(money.toMinor(amount));

    const currency = String(rowCurrency).toUpperCase();
    if (currency === 'INR') return money.toDecimalString(money.toMinor(amount));

    const usdRate = rates.get(currency);
    if (!usdRate) {
      this.logger?.warn({ currency }, 'No exchange rate for this currency — excluded from the converted total');
      return '0';
    }

    const inrPerUsd = money.divide('1', rates.get('INR'));
    return money.toDecimalString(money.multiply(money.multiply(amount, usdRate), money.toDecimalString(inrPerUsd)));
  }

  /** Turn grouped status rows into the summary shape the reports return. */
  #summarise(grouped, convert, currency) {
    const totals = {
      totalTransactions: 0,
      totalAmount: '0',
      successfulAmount: '0',
      processingAmount: '0',
      successfulTransactions: 0,
      processingTransactions: 0,
      failedTransactions: 0,
      currency,
    };

    for (const row of grouped) {
      const count = Number(row.count ?? 0);
      const amount = convert(row.amount ?? '0');
      const bucket = statusBucket('crypto', row.status);

      totals.totalTransactions += count;
      totals.totalAmount = money.toDecimalString(money.add(totals.totalAmount, amount));

      if (bucket === BUCKET.SUCCESS) {
        totals.successfulTransactions += count;
        totals.successfulAmount = money.toDecimalString(money.add(totals.successfulAmount, amount));
      } else if (bucket === BUCKET.PENDING) {
        totals.processingTransactions += count;
        totals.processingAmount = money.toDecimalString(money.add(totals.processingAmount, amount));
      } else if (bucket === BUCKET.FAILED) {
        totals.failedTransactions += count;
      }
    }

    return totals;
  }
}

module.exports = { DepositReportsService };
