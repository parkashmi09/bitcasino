'use strict';

const { Op, fn, col, literal, where: sqlWhere } = require('sequelize');
const { money } = require('@ibitplay/common');

/**
 * `WHERE lower(status) IN (…)`, as a fragment usable inside a `where` object.
 *
 * The four deposit tables disagree about the case of their status values, and
 * legacy compared each with `=` against one exact string — so a row differing
 * only in case was silently excluded from the platform's own revenue figure.
 *
 * `Sequelize.where(...)` returns a marker object that must sit inside `[Op.and]`
 * or an array. Spreading it into a plain `where` produces
 * `"attribute" = LOWER("status") AND "comparator" = '='` — a query against
 * columns that do not exist, which is what it silently became the first time.
 */
const statusIn = (statuses) => sqlWhere(fn('LOWER', col('status')), { [Op.in]: statuses });

const errors = require('./dashboard.errors');
const {
  COIN_IDS,
  DEPOSIT_SUCCESS,
  WITHDRAWAL_DONE,
  VALUATION_NOTE,
  TREND_DAYS,
  TOP_COUNTRIES,
  MOVEMENT_SOURCES,
  MAX_MOVEMENT_ROWS,
} = require('./dashboard.constants');

/**
 * The operator dashboard.
 *
 * Every USD figure is a conversion, and every conversion can fail to find a
 * rate. Legacy's INNER JOIN dropped those rows silently; here the volume that
 * could not be converted is counted and reported, so a total that is missing
 * something says so on the same screen.
 */
class DashboardService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Headline
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/dashboard
   *
   * ─────────────────────────────────────────────────────────────────────
   * `from`/`to` ADD A THIRD FIGURE. THEY DO NOT REDEFINE THE OTHER TWO.
   *
   * A windowed request answers `lifetime`, `today` AND `range`. It would have
   * been less code to let the window narrow `lifetime`, and it would have made
   * a field called "lifetime" mean "the last fortnight" — the exact class of
   * lie this module keeps unwinding. `lifetime` is always all of it, `today`
   * is always today, and `range` exists only when one was asked for.
   * ─────────────────────────────────────────────────────────────────────
   */
  async overview({ from, to } = {}) {
    const startOfToday = this.#startOfToday();
    const rates = await this.#rates();
    const range = this.#range(from, to);

    const [users, newToday, usersInRange, deposits, withdrawals] = await Promise.all([
      this.models.Users.count(),
      this.models.Users.count({ where: { created: { [Op.gte]: startOfToday } } }),
      range ? this.models.Users.count({ where: { created: this.#between(range) } }) : null,
      this.#depositTotals(rates, startOfToday, range),
      this.#withdrawalTotals(rates, startOfToday, range),
    ]);

    const net = (side) =>
      money.toDecimalString(money.toMinor(deposits[side].usd) - money.toMinor(withdrawals[side].usd));

    return {
      users: {
        total: users,
        newToday,
        /**
         * Legacy reported `previousTotalUsers = total − newToday`, which is the
         * count as of midnight. Named for what it is rather than "previous".
         */
        asOfMidnight: users - newToday,
        ...(range ? { inRange: usersInRange } : {}),
      },

      deposits,
      withdrawals,

      net: {
        today: net('today'),
        lifetime: net('lifetime'),
        ...(range ? { range: net('range') } : {}),
      },

      /** Echoed so a screen can label which window it is showing. */
      range: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null,

      /**
       * The health warning, on the payload rather than in a comment nobody
       * reads. Lifetime figures are marked to today's rates — see
       * `dashboard.constants.js`.
       */
      valuation: {
        currency: 'USD',
        note: VALUATION_NOTE,
        ratesAsOf: rates.asOf,
        knownCurrencies: rates.map.size,
      },
    };
  }

  /**
   * @legacy GET /api/admin/user-stats
   *
   * Registration and verification, over time.
   */
  async userStats({ from, to } = {}) {
    const startOfToday = this.#startOfToday();
    const thirtyDaysAgo = new Date(Date.now() - TREND_DAYS * 86_400_000);
    const sixtyDaysAgo = new Date(Date.now() - 2 * TREND_DAYS * 86_400_000);
    const range = this.#range(from, to);

    /**
     * The trend and the country split follow the WINDOW when one is given.
     *
     * These two are the panel's only shape-of-the-data answers, so a window
     * that moved the headline counts and left the charts on a fixed 30 days
     * would put two different questions on one screen with nothing marking
     * which was which.
     */
    const trendWhere = range ? this.#between(range) : { [Op.gte]: thirtyDaysAgo };

    const [total, newToday, registeredRecently, registeredPreviously, verified, inRange, countries, trend] =
      await Promise.all([
        this.models.Users.count(),
        this.models.Users.count({ where: { created: { [Op.gte]: startOfToday } } }),
        this.models.Users.count({ where: { created: { [Op.gte]: thirtyDaysAgo } } }),
        this.models.Users.count({
          where: { created: { [Op.gte]: sixtyDaysAgo, [Op.lt]: thirtyDaysAgo } },
        }),
        this.models.UserKyc.count({ where: { status: { [Op.iLike]: 'Verified' } } }),
        range ? this.models.Users.count({ where: { created: this.#between(range) } }) : null,
        this.models.Users.findAll({
          where: {
            country: { [Op.ne]: null },
            ...(range ? { created: this.#between(range) } : {}),
          },
          attributes: ['country', [fn('COUNT', literal('*')), 'count']],
          group: ['country'],
          order: [[fn('COUNT', literal('*')), 'DESC']],
          limit: TOP_COUNTRIES,
          raw: true,
        }),
        this.models.Users.findAll({
          where: { created: trendWhere },
          attributes: [[fn('DATE', col('created')), 'date'], [fn('COUNT', literal('*')), 'count']],
          group: [fn('DATE', col('created'))],
          order: [[fn('DATE', col('created')), 'ASC']],
          raw: true,
        }),
      ]);

    return {
      total,
      newToday,
      asOfMidnight: total - newToday,
      ...(range ? { inRange } : {}),
      range: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null,

      /**
       * ─────────────────────────────────────────────────────────────────
       * THIS FIELD WAS CALLED `activeUsers30d` AND COUNTED SIGNUPS
       *
       *     pg.query("SELECT COUNT(*) as active FROM users
       *                WHERE created >= (CURRENT_DATE - INTERVAL '30 days')")
       *
       * `created` is the REGISTRATION date. A player who joined two years ago
       * and bet this morning was not counted; a player who registered last week
       * and never returned was. Every dashboard reading "Active Users (30d)"
       * has been showing new registrations.
       *
       * The platform has no session or login table to derive true activity
       * from — the marketing panel hit the same wall and named its field
       * `activeDepositors` for the same reason. Renamed rather than fixed,
       * because a number with an honest name beats a wrong one with a good
       * name, and inventing activity data would be worse than either.
       * ─────────────────────────────────────────────────────────────────
       */
      registeredLast30Days: registeredRecently,
      registeredPrevious30Days: registeredPreviously,

      /**
       * Legacy's `previousVerifiedUsers` filtered on `u.created < today` —
       * users VERIFIED at any time who REGISTERED before today. A player who
       * signed up last year and verified this morning counted in both figures,
       * so the delta showed no growth. There is no verification timestamp to
       * do better with, so only the current count is reported.
       */
      verified,

      topCountries: countries.map((row) => ({ country: row.country, count: Number(row.count) })),
      registrationTrend: trend.map((row) => ({
        date: new Date(row.date).toISOString().slice(0, 10),
        count: Number(row.count),
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Today, and lifetime
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /today-deposits
   * @legacy GET /today-withdrawals
   * @legacy GET /today-transactions
   *
   * Legacy returned `SELECT *` — every column, unauthenticated. These are
   * summaries with the identifying columns left out; the full row is available
   * through the deposits module, which is guarded and audited.
   */
  async today({ kind = 'both', limit = 100, offset = 0 }) {
    const startOfToday = this.#startOfToday();
    const rows = [];

    if (kind === 'deposits' || kind === 'both') {
      const deposits = await this.models.Deposits.findAll({
        where: { date: { [Op.gte]: startOfToday } },
        order: [['date', 'DESC']],
        raw: true,
      });
      rows.push(...deposits.map((row) => this.#summariseMovement(row, 'deposit')));
    }

    if (kind === 'withdrawals' || kind === 'both') {
      /**
       * `/today-transactions` used `pool.query` here — an identifier declared
       * nowhere in the file — so the route threw ReferenceError on every
       * request and has never returned a withdrawal.
       */
      const withdrawals = await this.models.Withdrawals.findAll({
        where: { date: { [Op.gte]: startOfToday } },
        order: [['date', 'DESC']],
        raw: true,
      });
      rows.push(...withdrawals.map((row) => this.#summariseMovement(row, 'withdrawal')));
    }

    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return { total: rows.length, rows: rows.slice(offset, offset + limit) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Drill-down — the rows behind a headline figure
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Individual movements, across every table the totals are summed from.
   *
   * ═════════════════════════════════════════════════════════════════════
   * WHY THIS EXISTS RATHER THAN A FILTER ON `today()`
   *
   * `today()` selects from `deposits` and `withdrawals`. The headline deposit
   * figure sums FOUR tables — `ccdeposit`, `fiat_deposits`, `apaydeposits` and
   * `pay_in_transactions` — and `deposits` is not among them. So the list a
   * reader opens from a total has never contained the rows that total is made
   * of, and nothing on the screen said so.
   *
   * This reads `MOVEMENT_SOURCES`, which is the same list the totals read, and
   * names the source on every row: "where the amount came from" is the
   * question the drill-down is for.
   *
   * The identifying columns stay out — no wallet address, no bank account, no
   * transaction hash. Legacy's `SELECT *` returned all of them, unauthenticated.
   * ═════════════════════════════════════════════════════════════════════
   */
  async movements({ kind = 'both', from, to, userId, source, limit = 50, offset = 0 }) {
    const rates = await this.#rates();
    const range = this.#range(from, to);

    const wanted = MOVEMENT_SOURCES.filter(
      (s) =>
        (kind === 'both' || s.direction === kind.replace(/s$/, '')) &&
        (!source || s.key === source)
    );

    /**
     * How many rows each table must give up.
     *
     * Merging six date-sorted lists needs no more than `offset + limit` from
     * any one of them — the row at position N of the merge cannot come from
     * deeper than position N of its own source.
     */
    const depth = Math.min(offset + limit, MAX_MOVEMENT_ROWS);

    const perSource = await Promise.all(
      wanted.map(async (s) => {
        const where = this.#movementWhere(s, { range, userId });
        const [rows, grouped, count] = await Promise.all([
          this.models[s.model].findAll({
            where,
            attributes: [s.id, s.user, s.date, s.amount, 'status', s.currency ?? s.coinId],
            order: [[s.date, 'DESC']],
            limit: depth,
            raw: true,
          }),
          this.models[s.model].findAll({
            where,
            attributes: [
              s.currency ?? s.coinId,
              [fn('COALESCE', fn('SUM', col(s.amount)), 0), 'total'],
              [fn('COUNT', literal('*')), 'count'],
            ],
            group: [s.currency ?? s.coinId],
            raw: true,
          }),
          this.models[s.model].count({ where }),
        ]);

        return {
          count,
          groups: grouped.map((row) => ({
            currency: s.coinId ? COIN_IDS[row[s.coinId]] ?? null : row[s.currency],
            total: row.total,
            count: Number(row.count),
          })),
          rows: rows.map((row) => ({
            id: `${s.key}:${row[s.id]}`,
            source: s.key,
            sourceLabel: s.label,
            direction: s.direction,
            at: row[s.date] ?? null,
            userId: row[s.user] != null ? String(row[s.user]) : null,
            currency: s.coinId ? COIN_IDS[row[s.coinId]] ?? null : row[s.currency] ?? null,
            amount: money.toDecimalString(money.toMinor(row[s.amount] ?? '0')),
            status: row.status != null ? String(row.status) : null,
          })),
        };
      })
    );

    const merged = perSource
      .flatMap((s) => s.rows)
      .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

    const page = merged.slice(offset, offset + limit);
    const owners = await this.#ownersOf(page.map((row) => row.userId));

    return {
      total: perSource.reduce((sum, s) => sum + s.count, 0),
      /**
       * The totals for THIS filter, not for the whole board — so a reader who
       * narrows to one source or one player sees a figure that matches the
       * rows in front of them.
       */
      totals: this.#convert(
        perSource.flatMap((s) => s.groups),
        rates,
        { amountKey: 'total', currencyKey: 'currency' }
      ),
      range: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null,
      rows: page.map((row) => ({
        ...row,
        usd: this.#toUsd(row.amount, row.currency, rates),
        user: owners.get(String(row.userId)) ?? null,
      })),
    };
  }

  /**
   * The players behind a registration figure.
   *
   * The user cards drill into this. `verified` is resolved per row rather than
   * joined, because `user_kyc` holds one row per SUBMISSION and a join would
   * multiply a player by their attempts.
   */
  async registrations({ from, to, search, limit = 50, offset = 0 }) {
    const range = this.#range(from, to);

    const where = {
      ...(range ? { created: this.#between(range) } : {}),
      ...(search
        ? {
            [Op.or]: [
              { name: { [Op.iLike]: `%${search}%` } },
              { email: { [Op.iLike]: `%${search}%` } },
            ],
          }
        : {}),
    };

    const { rows, count } = await this.models.Users.findAndCountAll({
      where,
      attributes: ['id', 'name', 'email', 'country', 'created', 'parent_staff_id'],
      order: [['created', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const ids = rows.map((r) => r.id);
    const kyc = ids.length
      ? await this.models.UserKyc.findAll({
          // `user_kyc.user_id` is VARCHAR while `users.id` is BIGINT — passing
          // the numbers through is `character varying = integer`, which
          // Postgres refuses rather than coerces.
          where: { user_id: ids.map(String), status: { [Op.iLike]: 'Verified' } },
          attributes: ['user_id'],
          raw: true,
        })
      : [];
    const verifiedIds = new Set(kyc.map((r) => String(r.user_id)));

    return {
      total: count,
      range: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null,
      rows: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        email: r.email ?? null,
        country: r.country ?? null,
        registeredAt: r.created,
        verified: verifiedIds.has(String(r.id)),
        /** Direct signup or agent-anchored — the tab's own distinction. */
        channel: r.parent_staff_id ? 'agent' : 'direct',
      })),
    };
  }

  /**
   * @legacy GET /total-deposits
   * @legacy GET /total-withdrawals
   *
   * ─────────────────────────────────────────────────────────────────────
   * LEGACY LOOPED OVER EVERY ROW EVER
   *
   *     const result = await pg.query('SELECT amount, coin FROM deposits');
   *     for (const deposit of result.rows) {
   *       totalDeposits += await convertToUSDT(deposit.amount, deposit.coin);
   *     }
   *
   * Unauthenticated, unbounded, and `convertToUSDT` is an async call per row.
   * Grouped by coin here — one row per currency regardless of history size.
   * ─────────────────────────────────────────────────────────────────────
   */
  async lifetimeTotals({ kind }) {
    const rates = await this.#rates();

    const model = kind === 'withdrawals' ? this.models.Withdrawals : this.models.Deposits;
    const statuses = kind === 'withdrawals' ? WITHDRAWAL_DONE.withdrawals : null;

    const grouped = await model.findAll({
      where: statuses ? { [Op.and]: [statusIn(statuses)] } : {},
      attributes: ['coin', [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'], [fn('COUNT', literal('*')), 'count']],
      group: ['coin'],
      raw: true,
    });

    return this.#convert(grouped, rates, { amountKey: 'total', currencyKey: 'coin' });
  }

  /**
   * @legacy GET /api/members/:uid
   *
   * A player's referral team and what each member has earned them.
   *
   * Legacy served this with no authentication, keyed on a raw uid.
   */
  async memberTeam({ userId }) {
    const user = await this.models.Users.findOne({
      where: { id: userId },
      attributes: ['id', 'name'],
      raw: true,
    });
    if (!user) throw errors.PLAYER_NOT_FOUND({ userId });

    const members = await this.models.Team.findAll({
      where: { ownername: user.name },
      attributes: ['membername'],
      raw: true,
    });

    const names = members.map((m) => m.membername).filter(Boolean);
    if (!names.length) return { owner: user.name, totalMembers: 0, members: [] };

    const earned = await this.models.Rewards.findAll({
      where: { ownername: user.name, membername: names },
      attributes: ['membername', [fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
      group: ['membername'],
      raw: true,
    });

    const byMember = new Map(earned.map((row) => [row.membername, row.total]));

    return {
      owner: user.name,
      totalMembers: names.length,
      members: names.map((name) => ({
        name,
        commission: money.toDecimalString(money.toMinor(byMember.get(name) ?? '0')),
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  /** Every deposit source, converted, with what could not be converted. */
  async #depositTotals(rates, startOfToday, range) {
    const window = (since) => [
      this.#groupCcdeposit(since),
      this.#groupByCurrency(this.models.FiatDeposits, DEPOSIT_SUCCESS.fiat_deposits, 'created_at', since),
      this.#groupByCurrency(this.models.Apaydeposits, DEPOSIT_SUCCESS.apaydeposits, 'created_at', since),
      this.#groupPayIn(since),
    ];

    const [lifetime, today, inRange] = await Promise.all([
      Promise.all(window(null)),
      Promise.all(window(startOfToday)),
      range ? Promise.all(window(range)) : null,
    ]);

    return {
      lifetime: this.#merge(rates, lifetime),
      today: this.#merge(rates, today),
      ...(range ? { range: this.#merge(rates, inRange) } : {}),
    };
  }

  async #withdrawalTotals(rates, startOfToday, range) {
    const window = (since) => [
      this.#groupByCurrency(this.models.Withdrawals, WITHDRAWAL_DONE.withdrawals, 'date', since, 'coin'),
      this.#groupByCurrency(this.models.FiatWithdrawals, WITHDRAWAL_DONE.fiat_withdrawals, 'date', since),
    ];

    const [lifetime, today, inRange] = await Promise.all([
      Promise.all(window(null)),
      Promise.all(window(startOfToday)),
      range ? Promise.all(window(range)) : null,
    ]);

    return {
      lifetime: this.#merge(rates, lifetime),
      today: this.#merge(rates, today),
      ...(range ? { range: this.#merge(rates, inRange) } : {}),
    };
  }

  /**
   * `ccdeposit` has no currency column — it has a coin id.
   *
   * Legacy expressed the mapping as a twelve-way CASE inside the JOIN, four
   * times in one handler. Grouped by id here and mapped in JavaScript, which is
   * the same arithmetic with one copy of the table.
   */
  async #groupCcdeposit(since) {
    const rows = await this.models.Ccdeposit.findAll({
      where: {
        [Op.and]: [statusIn(DEPOSIT_SUCCESS.ccdeposit)],
        ...this.#windowWhere('created_at', since),
      },
      attributes: ['coinid', [fn('COALESCE', fn('SUM', col('price')), 0), 'total'], [fn('COUNT', literal('*')), 'count']],
      group: ['coinid'],
      raw: true,
    });

    return rows.map((row) => ({
      currency: COIN_IDS[row.coinid] ?? null,
      total: row.total,
      count: Number(row.count),
    }));
  }

  async #groupPayIn(since) {
    const rows = await this.models.PayInTransactions.findAll({
      where: {
        status: { [Op.in]: DEPOSIT_SUCCESS.pay_in_transactions },
        ...this.#windowWhere('created_at', since),
      },
      attributes: ['currency', [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'], [fn('COUNT', literal('*')), 'count']],
      group: ['currency'],
      raw: true,
    });
    return rows.map((row) => ({ currency: row.currency, total: row.total, count: Number(row.count) }));
  }

  async #groupByCurrency(model, statuses, dateColumn, since, currencyColumn = 'currency') {
    const rows = await model.findAll({
      where: {
        ...(statuses ? { [Op.and]: [statusIn(statuses)] } : {}),
        ...this.#windowWhere(dateColumn, since),
      },
      attributes: [
        currencyColumn,
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'],
        [fn('COUNT', literal('*')), 'count'],
      ],
      group: [currencyColumn],
      raw: true,
    });

    return rows.map((row) => ({ currency: row[currencyColumn], total: row.total, count: Number(row.count) }));
  }

  /** The rate table, once per request rather than once per row. */
  async #rates() {
    const rows = await this.models.Exchangerate.findAll({ raw: true });
    return {
      map: new Map(rows.map((r) => [String(r.currency ?? '').toUpperCase(), r.usd_rate])),
      asOf: rows.reduce(
        (latest, r) => (r.updated_at && (!latest || r.updated_at > latest) ? r.updated_at : latest),
        null
      ),
    };
  }

  #merge(rates, groups) {
    return this.#convert(groups.flat(), rates, { amountKey: 'total', currencyKey: 'currency' });
  }

  /**
   * Convert a set of per-currency totals to USD.
   *
   * ─────────────────────────────────────────────────────────────────────
   * WHAT COULD NOT BE CONVERTED IS REPORTED, NOT DROPPED
   *
   * Legacy's `JOIN exchangerate e ON f.currency = e.currency` is an INNER
   * join. A deposit in a currency with no rate row simply vanished from the
   * total — the figure was smaller and nothing said so.
   * ─────────────────────────────────────────────────────────────────────
   */
  #convert(groups, rates, { amountKey, currencyKey }) {
    let usd = 0n;
    let count = 0;
    const byCurrency = [];
    const unconverted = [];

    for (const group of groups) {
      const currency = String(group[currencyKey] ?? '').toUpperCase();
      const amount = money.toMinor(group[amountKey] ?? '0');
      count += Number(group.count) || 0;

      const rate = rates.map.get(currency);

      if (!currency || rate == null) {
        unconverted.push({
          currency: currency || null,
          amount: money.toDecimalString(amount),
          count: Number(group.count) || 0,
          reason: currency ? 'no exchange rate' : 'unknown coin id',
        });
        continue;
      }

      /**
       * Rate multiplication in minor units.
       *
       * `toMinor` gives 8 decimal places, so multiplying two minor values gives
       * 16 and has to come back down. Done as one BigInt operation rather than
       * as a float, because a rate like 0.012 is not representable and the
       * error would be multiplied by the whole platform's deposit volume.
       */
      const rateMinor = money.toMinor(rate);
      const converted = (amount * rateMinor) / 100_000_000n;

      usd += converted;
      byCurrency.push({
        currency,
        amount: money.toDecimalString(amount),
        usd: money.toDecimalString(converted),
        count: Number(group.count) || 0,
      });
    }

    byCurrency.sort((a, b) => (money.toMinor(b.usd) > money.toMinor(a.usd) ? 1 : -1));

    return {
      usd: money.toDecimalString(usd),
      count,
      byCurrency,
      /**
       * Non-empty means the USD figure above is INCOMPLETE by the amounts
       * listed. The screen is expected to say so.
       */
      unconverted,
    };
  }

  /** The identifying columns are deliberately not here. */
  #summariseMovement(row, direction) {
    return {
      id: String(row.id),
      direction,
      at: row.date ?? row.created_at ?? null,
      currency: row.coin ?? row.currency ?? null,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      status: row.status ?? null,
      /**
       * The user id, but not the wallet address, transaction hash, bank
       * account or any other identifier legacy's `SELECT *` returned to an
       * unauthenticated caller.
       */
      userId: row.uid != null ? String(row.uid) : row.user_id != null ? String(row.user_id) : null,
    };
  }

  /** Midnight today, in the server's timezone — matching `CURRENT_DATE`. */
  #startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Windows
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A requested window, or `null` when none was asked for.
   *
   * Either end may be omitted: `from` alone is "since", `to` alone is "up to",
   * and both absent is no window at all — which is the difference between
   * "the operator did not filter" and "the operator asked for everything up to
   * the epoch". The open end is filled with a bound wide enough to be inert
   * rather than left undefined for the query builder to interpret.
   */
  #range(from, to) {
    if (!from && !to) return null;
    return {
      from: from ? new Date(from) : new Date(0),
      // `to` arrives as an instant, not a day. A caller wanting a whole day
      // sends its last moment; this does not round one up for them, because
      // guessing at the boundary is how a range quietly includes tomorrow.
      to: to ? new Date(to) : new Date(),
    };
  }

  /** `{[Op.between]}` for a resolved range. */
  #between(range) {
    return { [Op.between]: [range.from, range.to] };
  }

  /**
   * The date clause for one column.
   *
   * `since` is overloaded on purpose so the grouping helpers take one argument
   * for all three windows: a Date means "from here on" (today), a range object
   * means between its ends, and null means no constraint (lifetime).
   */
  #windowWhere(column, since) {
    if (!since) return {};
    if (since instanceof Date) return { [column]: { [Op.gte]: since } };
    return { [column]: this.#between(since) };
  }

  /** The `where` for one movement source: its statuses, the window, the player. */
  #movementWhere(source, { range, userId }) {
    return {
      ...(source.statusIsText
        ? { [Op.and]: [statusIn(source.statuses)] }
        : { status: { [Op.in]: source.statuses } }),
      ...this.#windowWhere(source.date, range),
      ...(userId != null
        ? { [source.user]: source.userIsText ? String(userId) : userId }
        : {}),
    };
  }

  /**
   * `user_id -> {name, email}` for the ids on one page.
   *
   * Keyed on a STRING id — these columns are BIGINT and come back as a string
   * from one driver path and a number from another, so a numeric key misses.
   */
  async #ownersOf(userIds) {
    const ids = [...new Set(userIds.filter((id) => id !== null && id !== undefined))];
    if (!ids.length) return new Map();

    const users = await this.models.Users.findAll({
      where: { id: ids },
      attributes: ['id', 'name', 'email'],
      raw: true,
    });

    return new Map(
      users.map((u) => [String(u.id), { id: String(u.id), name: u.name, email: u.email ?? null }])
    );
  }

  /**
   * One row's value in USD, or `null` when no rate covers its currency.
   *
   * `null` rather than `0`: a row worth an unknown amount and a row worth
   * nothing are different facts, and the totals already report the gap
   * separately under `unconverted`.
   */
  #toUsd(amount, currency, rates) {
    const rate = rates.map.get(String(currency ?? '').toUpperCase());
    if (rate == null) return null;
    return money.toDecimalString((money.toMinor(amount) * money.toMinor(rate)) / 100_000_000n);
  }
}

module.exports = { DashboardService };
