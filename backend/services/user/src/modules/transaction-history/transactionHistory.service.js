'use strict';

const { money } = require('@ibitplay/common');
const { Op, fn, col } = require('@ibitplay/db');

const {
  DEPOSIT_SOURCES,
  WITHDRAWAL_SOURCES,
  NUMERIC_STATUS,
  normaliseStatus,
} = require('./transactionHistory.constants');
const { ccpaymentCoinId, ccpaymentTicker } = require('../payment-orders/gateways');

/**
 * Deposit and withdrawal history, crypto and fiat.
 *
 * Replaces three legacy routers that between them had ten endpoints and no
 * authentication on any of them:
 *
 *   legacy/depositHistory/routes.js        4  (admin listings)
 *   legacy/depositHistory/routesusers.js   4  GET /user/crypto/deposits/:userId
 *   legacy/withdrawHistory/routeshistory.js 2  GET /user/withdrawals/:userId
 *
 * The `:userId` in those paths was the only thing identifying the player, so
 * any history was readable by changing a number in the URL. Here the player
 * endpoints take the id from the token and the staff endpoints require a
 * permission.
 *
 * Read-only throughout — nothing in this module moves money.
 */
class TransactionHistoryService {
  constructor({ models, logger, clients, config }) {
    this.models = models;
    this.logger = logger;
    this.clients = clients;
    // Only for `ccdeposit.coinid`, which stores CCPayment's own coin NUMBER.
    // The configured map that chose the number is the only thing that turns it
    // back into a ticker.
    this.config = config;
  }

  /**
   * @legacy GET /sportsbetting/transfers/:userUuid
   *
   * Money moved between this player and staff — an agent topping them up, or
   * taking a balance back.
   *
   * `staff_transfers` is admin-owned, so this asks admin-service rather than
   * reading a table user-service does not load. Legacy served it from inside
   * the SPORTS BETTING router, keyed on a `uuid` in the URL with no
   * authentication, so any uuid returned that player's transfer history.
   */
  async staffTransfers({ userId, limit = 50, offset = 0 }) {
    const result = await this.clients.admin.get(
      `/internal/admin/staff-directory/transfers/user/${userId}`,
      { query: { limit, offset } }
    );
    const body = result?.data ?? result;
    return { total: body?.total ?? 0, rows: body?.rows ?? [] };
  }

  // ── Crypto deposits (`deposits`) ─────────────────────────────────────

  /**
   * @legacy GET /getDepositData
   * @legacy GET /deposits
   * @legacy GET /user/crypto/deposits/:userId
   *
   * ─────────────────────────────────────────────────────────────────────
   * `GET /deposits` WAS `SELECT * FROM deposits`
   *
   * Unauthenticated, unpaged, unfiltered — every deposit on the platform, with
   * the player id, amount, coin and on-chain transaction id of each. It then
   * awaited `convertToUSDT` once per row inside a `Promise.all` over the whole
   * table, so the cost grew with the table on every call.
   *
   * `GET /getDepositData` was the same data with a `JOIN users` for the name,
   * also unauthenticated. Both are this method: paged, filtered, and behind a
   * permission on the admin router.
   *
   * The USDT conversion is gone. A converted figure computed at read time is a
   * different number every call, so it reconciles against nothing;
   * `modules/exchange-rate` converts when a caller actually wants one number.
   * ─────────────────────────────────────────────────────────────────────
   */
  async cryptoDeposits({ userId, currency, from, to, limit, offset }) {
    const result = await this.models.Deposits.findAndCountAll({
      where: {
        ...(userId ? { uid: userId } : {}),
        ...(currency ? { coin: currency } : {}),
        ...this.#dateRange('date', from, to),
      },
      order: [['date', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      count: result.count,
      rows: result.rows.map((r) => ({
        id: r.id,
        userId: r.uid,
        amount: money.toDecimalString(money.toMinor(r.amount ?? '0')),
        currency: r.coin,
        status: r.status,
        transactionId: r.txtid,
        createdAt: r.date,
      })),
    };
  }

  /** @legacy GET /user/crypto/stats/:userId */
  async cryptoStats({ userId, currency }) {
    return this.#sumBy(this.models.Deposits, {
      where: { ...(userId ? { uid: userId } : {}), ...(currency ? { coin: currency } : {}) },
      amountColumn: 'amount',
      groupColumn: 'coin',
    });
  }

  // ── Fiat deposits (`fiat_deposits`) ──────────────────────────────────

  /**
   * @legacy GET /user/fiat/deposits/:userId
   *
   * `legacy/depositHistory/` shipped TWO routers over these tables —
   * `routes.js`, which was mounted, and `routesusers.js`, which was not
   * required by any entry point. The unmounted copy took the player from the
   * URL with no authentication; this is the one implementation.
   */
  async fiatDeposits({ userId, currency, status, from, to, limit, offset }) {
    const result = await this.models.FiatDeposits.findAndCountAll({
      where: {
        ...(userId ? { user_id: userId } : {}),
        ...(currency ? { currency } : {}),
        ...(status ? { status } : {}),
        ...this.#dateRange('created_at', from, to),
      },
      order: [['deposit_id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      count: result.count,
      rows: result.rows.map((r) => ({
        id: r.deposit_id,
        userId: r.user_id,
        amount: money.toDecimalString(money.toMinor(r.amount ?? '0')),
        currency: r.currency,
        status: r.status,
        transactionId: r.transaction_id,
        createdAt: r.created_at,
      })),
    };
  }

  /** @legacy GET /user/fiat/stats/:userId */
  async fiatStats({ userId, currency }) {
    return this.#sumBy(this.models.FiatDeposits, {
      where: {
        ...(userId ? { user_id: userId } : {}),
        ...(currency ? { currency } : {}),
        // Only approved deposits are money that actually arrived. Legacy summed
        // every row regardless of status, so a pending or rejected request
        // inflated the total.
        status: 'approved',
      },
      amountColumn: 'amount',
      groupColumn: 'currency',
    });
  }

  // ── Withdrawals ──────────────────────────────────────────────────────

  /**
   * A player's withdrawals, as history.
   *
   * The review QUEUE — and the decision that moves money — is
   * `modules/crypto-withdraw`. This is the read-only view; nothing here can
   * change a withdrawal's state, which is the point of the split.
   */
  async withdrawals({ userId, currency, status, from, to, limit, offset }) {
    const result = await this.models.FiatWithdrawals.findAndCountAll({
      where: {
        ...(userId ? { uid: userId } : {}),
        ...(currency ? { currency } : {}),
        ...(status ? { status } : {}),
        ...this.#dateRange('date', from, to),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      count: result.count,
      rows: result.rows.map((r) => ({
        id: r.id,
        userId: r.uid,
        amount: money.toDecimalString(money.toMinor(r.amount ?? '0')),
        currency: r.currency,
        status: r.status,
        createdAt: r.date,
      })),
    };
  }

  async withdrawalStats({ userId, currency }) {
    return this.#sumBy(this.models.FiatWithdrawals, {
      where: { ...(userId ? { uid: userId } : {}), ...(currency ? { currency } : {}) },
      amountColumn: 'amount',
      groupColumn: 'currency',
    });
  }

  // ── Every rail, in one shape ─────────────────────────────────────────

  /**
   * Every deposit the player has made, on any rail.
   *
   * @legacy GET /api/depositNew
   *
   * ─────────────────────────────────────────────────────────────────────
   * THIS READ FOUR TABLES AND WAS PORTED AS TWO — AND THE WRONG TWO
   *
   * Legacy queried `ccdeposit`, `fiat_deposits`, `apaydeposits` and
   * `pay_in_transactions`. The port read `deposits` and `fiat_deposits`, and
   * `deposits` is a table nothing in the new backend writes — crypto deposits
   * land in `ccdeposit` (`modules/crypto`), and the A-Pay and WayPay rails
   * (`modules/psp`) were missing entirely. A player who deposited through any
   * of the three saw an empty history, which is indistinguishable from having
   * lost the money.
   *
   * Legacy also served the two groups under keys shaped differently from each
   * other, so the screen consuming it had a branch per type. One shape here.
   * ─────────────────────────────────────────────────────────────────────
   */
  async allDeposits({ userId, currency, status, from, to, limit = 50, offset = 0 }) {
    return this.#fromSources(DEPOSIT_SOURCES, {
      userId,
      currency,
      status,
      from,
      to,
      limit,
      offset,
      kind: 'deposit',
    });
  }

  /**
   * Every withdrawal the player has requested, on any rail.
   *
   * @legacy GET /api/withdrawNew
   *
   * Legacy read `withdrawals`, `fiat_withdrawals` and `apaywithdrawals`. The
   * port read `fiat_withdrawals` alone, so a crypto payout — the one with an
   * on-chain transaction the player most wants to check — appeared nowhere,
   * and neither did anything paid out through A-Pay.
   *
   * Legacy returned the A-Pay rows TWICE: merged into `fiatWithdrawals` and
   * again under `apayWithdrawals`, "also exposed separately for the UI if
   * needed". A client that read both keys double-counted every A-Pay payout.
   * There is one list here, and `method` says which rail each row came from.
   */
  async allWithdrawals({ userId, currency, status, from, to, limit = 50, offset = 0 }) {
    return this.#fromSources(WITHDRAWAL_SOURCES, {
      userId,
      currency,
      status,
      from,
      to,
      limit,
      offset,
      kind: 'withdrawal',
    });
  }

  /**
   * Everything for one player, in one call — what a statement screen needs.
   *
   * Deposits and withdrawals, every rail, both under the same row shape.
   */
  async combined({ userId, currency, status, from, to, limit, offset }) {
    const [deposits, withdrawals] = await Promise.all([
      this.allDeposits({ userId, currency, status, from, to, limit, offset }),
      this.allWithdrawals({ userId, currency, status, from, to, limit, offset }),
    ]);

    return { deposits, withdrawals };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Query a set of rails and merge them into one page, newest first.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE MERGE IS IN MEMORY, AND BOUNDED
   *
   * Seven tables with no common key and no common date column cannot be paged
   * by the database without a UNION that casts four columns in every branch.
   * So each rail is asked for at most `offset + limit` of its own newest rows —
   * which is the most that could possibly survive the merge — and the slice
   * happens here. Worst case is `rails × (offset + limit)` rows in memory, with
   * `limit` capped at 200 by the validator.
   *
   * `count` is the sum of the per-rail counts, so it is the real total even
   * though only a page of rows was fetched. Legacy fetched every row of every
   * table with no limit at all and sorted the lot.
   * ─────────────────────────────────────────────────────────────────────
   */
  async #fromSources(sources, { userId, currency, status, from, to, limit, offset, kind }) {
    const ticker = (coinId) => ccpaymentTicker(coinId, this.config) ?? (coinId == null ? null : String(coinId));
    const helpers = { maskWallet: (w) => this.#maskWallet(w) };

    const results = await Promise.all(
      sources.map(async (source) => {
        const where = this.#whereFor(source, { userId, currency, status, from, to });

        // A currency filter this rail cannot express means the rail holds
        // nothing the caller asked for — not that the filter should be ignored.
        if (where === null) return { count: 0, rows: [] };

        const { count, rows } = await this.models[source.model].findAndCountAll({
          where,
          order: [[source.dateColumn, 'DESC'], [source.orderColumn, 'DESC']],
          limit: limit + offset,
          raw: true,
        });

        return {
          count,
          rows: rows.map((row) => {
            const shaped = source.present(row, {
              ...helpers,
              ticker: source.coinIdColumn ? ticker(row[source.coinIdColumn]) : null,
            });
            return {
              ...shaped,
              kind,
              method: source.method,
              type: source.type,
              userId: row[source.userColumn],
              amount: money.fromStored(shaped.amount ?? '0'),
              status: normaliseStatus(shaped.status),
              date: shaped.date ?? null,
            };
          }),
        };
      })
    );

    const merged = results
      .flatMap((r) => r.rows)
      .sort((a, b) => new Date(b.date ?? 0) - new Date(a.date ?? 0));

    return {
      count: results.reduce((total, r) => total + r.count, 0),
      rows: merged.slice(offset, offset + limit),
    };
  }

  /**
   * One rail's WHERE clause, or `null` when the filter excludes the rail.
   *
   * The user id is cast to the type that rail's column actually is —
   * `apaydeposits.user_id` is BIGINT and `apaywithdrawals.user_id` is
   * VARCHAR(200), the same integration disagreeing with itself. Comparing a
   * number against the VARCHAR column returns nothing rather than erroring,
   * which is why this is a per-rail flag and not a cast at the call site.
   */
  #whereFor(source, { userId, currency, status, from, to }) {
    const where = {
      ...(userId !== undefined && userId !== null
        ? { [source.userColumn]: source.userIdIsText ? String(userId) : userId }
        : {}),
      ...this.#dateRange(source.dateColumn, from, to),
    };

    if (status) {
      /**
       * Matched against the status the caller can SEE, not the raw column.
       *
       * The rails spell the same state four ways — 'Success', 'approved',
       * 'Paid', `1` — so an exact match on the raw value finds one rail's rows
       * and silently misses the rest. Text columns match case-insensitively;
       * the numeric one is translated, and a word it has no number for means
       * the rail cannot be in that state.
       */
      if (source.statusIsNumeric) {
        const value = NUMERIC_STATUS[String(status).toLowerCase()];
        if (value === undefined) return null;
        where.status = value;
      } else {
        where.status = { [Op.iLike]: String(status) };
      }
    }

    if (!currency) return where;

    if (source.currencyColumn) return { ...where, [source.currencyColumn]: currency };

    // CCPayment stores a coin NUMBER, so the ticker has to be translated
    // through the same configured map that wrote it. An unmapped ticker means
    // this rail cannot hold that currency.
    if (source.coinIdColumn) {
      const coinId = ccpaymentCoinId(currency, this.config);
      return coinId == null ? null : { ...where, [source.coinIdColumn]: coinId };
    }

    return null;
  }

  /** A destination the player already knows, shortened. See `crypto-withdraw`. */
  #maskWallet(wallet) {
    const value = String(wallet ?? '');
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }

  /**
   * Totals per currency.
   *
   * Grouped rather than summed into one figure: adding BTC to INR produces a
   * number that means nothing, which is what legacy's single `SUM(amount)` did.
   */
  async #sumBy(model, { where, amountColumn, groupColumn }) {
    const rows = await model.findAll({
      attributes: [
        groupColumn,
        [fn('COUNT', col(amountColumn)), 'count'],
        [fn('COALESCE', fn('SUM', col(amountColumn)), 0), 'total'],
      ],
      where,
      group: [groupColumn],
      raw: true,
    });

    return rows.map((r) => ({
      currency: r[groupColumn],
      count: Number.parseInt(r.count, 10) || 0,
      total: money.toDecimalString(money.toMinor(r.total ?? '0')),
    }));
  }

  #dateRange(column, from, to) {
    if (!from && !to) return {};
    return {
      [column]: {
        ...(from ? { [Op.gte]: from } : {}),
        ...(to ? { [Op.lte]: to } : {}),
      },
    };
  }
}

module.exports = { TransactionHistoryService };
