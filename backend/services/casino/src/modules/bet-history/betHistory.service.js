'use strict';

const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./betHistory.errors');

/**
 * The start of a contest window, in UTC.
 *
 * UTC and not the server's local zone: a leaderboard that rolls over at the
 * host's midnight moves when the host moves, and every other date boundary in
 * this service (`analytics`'s `startOfDay`) is already UTC.
 *
 * `weekly` is the last SEVEN DAYS rather than "since Monday". A rolling window
 * is the one a player can reason about without knowing the operator's week
 * start, and it is what the front-end's contest tabs describe.
 */
const periodStart = (period) => {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  if (period === 'daily') {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'weekly') return new Date(now.getTime() - 7 * day);
  if (period === 'monthly') return new Date(now.getTime() - 30 * day);
  return null;
};

/**
 * Simulated rounds are not public results.
 *
 * QA tooling writes fake rows straight into `bets` to exercise wager, VIP and
 * rakeback without playing a game (game `qa40-sim`, five-figure INR stakes), and
 * marks each one with `result = {"fake": true, ...}`. Those rows filled the public
 * ticker and the big-wins board. The marker is the `fake` key, not the game name,
 * so any future simulator that sets it is excluded too. `->>` on a scalar or array
 * `result` (the `"refunded"` marker, a keno card) is NULL, so real rounds pass.
 * The rows stay in the table: staff history and the player's own list still show them.
 */
const NOT_FAKE = `("result"->>'fake') IS DISTINCT FROM 'true'`;

const {
  SOURCES,
  SOURCE_KEYS,
  CASINO_SOURCE_KEYS,
  CATALOGS,
  categoryOf,
  classify,
  kindOf,
  countExpressions,
  statExpressions,
  finishedOf,
  MAX_ROWS_PER_SOURCE,
  KIND,
} = require('./betHistory.constants');

/** How long a provider round with only its stake is treated as still in flight. */
const OPEN_ROUND_GRACE_MS = 60_000;

/**
 * Casino transaction history — across all four places a bet can live.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE STAFF SCOPE CAME FROM A RAW HEADER, ON UNAUTHENTICATED ROUTES
 *
 *     let ids = await visibleIds(req.headers['x-staff-id']);
 *
 * `x-staff-id: 1` returned every transaction on the platform — every player's
 * stake, win, and balance movement — to anyone who sent the header. There was
 * no token, no signature, and no check that the caller was staff at all.
 *
 * Worse, the tree query treats `1` as the root:
 *
 *     if (ids.includes(1)) val = true;   // ...and then `parent_staff_id IS NULL`
 *
 * so `x-staff-id: 1` ALSO unlocked the rows with no owner, which is the ones
 * that belong to nobody in particular — house accounts and orphans.
 *
 * Here the staff id comes from a verified token, and the visible tree is
 * resolved by admin-service, which owns the `staff` table.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE REPORTS DISAGREED WITH EACH OTHER
 *
 * Five handlers each wrote their own UNION with their own CASE expressions, and
 * they had drifted:
 *
 *   a zero-profit round was `BET` in getTransactionHistory,
 *                          neither win nor loss in getTransactionStats,
 *                          and `bet` in /admin/analytics.
 *
 * So "total transactions" from one endpoint never reconciled against the sum of
 * wins and losses from another. `classify()` in the constants file is the one
 * definition now, and every count here uses it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * IT FETCHED LIVE HISTORY OVER HTTP FROM ITSELF
 *
 *     const apiResponse = await axios.get('https://api.lagaobet.com/jsGamesv2/historyAdmin');
 *
 * A hard-coded absolute URL to a DIFFERENT DEPLOYMENT of this same codebase,
 * called synchronously inside a paginated report. If that host was slow, this
 * report was slow; if it was down, the report silently returned a page missing
 * a whole category of transactions, because the failure was swallowed:
 *
 *     } catch (apiError) { console.error(...); }   // continue
 *
 * jsGames v2 transactions are in `game_transactions` now — migration 016 — and
 * they are read from the database like every other source.
 */
class BetHistoryService {
  constructor({ models, config, logger, clients }) {
    this.models = models;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Listing
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /betHistory/transactions
   *
   * Every casino movement the caller is allowed to see, newest first.
   */
  async list({ page, limit, search, userId, from, to, source, staffId, channel, category, currency, casinoOnly = false }) {
    const visible = await this.#visibleUserIds({ staffId, userId, channel });
    if (visible.empty) return { rows: [], total: 0 };

    // An in-house round is always `original`, so a live / slots filter never reads `bets`.
    const keys = casinoOnly ? CASINO_SOURCE_KEYS : SOURCE_KEYS;
    const sources = source ? [source].filter((k) => keys.includes(k)) : keys;
    const wanted = category === 'live' || category === 'slots' ? sources.filter((k) => k !== 'inhouse') : sources;
    let collected = [];

    for (const key of wanted) {
      collected.push(...(await this.#read(key, { visible, from, to, search, currency })));
    }

    // Merged in memory because the four tables have no common key and no
    // shared ordering column the database could sort across. Each source is
    // capped, so the working set is bounded regardless of the date range.
    collected.sort((a, b) => new Date(b.transaction_timestamp) - new Date(a.transaction_timestamp));

    // A category filter needs every row's catalogue entry BEFORE paging (it decides which rows
    // exist); without one, only the page's rows are looked up — the rest are never rendered.
    let games = null;
    if (category) {
      games = await this.#gameLabels(collected);
      collected = collected.filter((row) => this.#categoryOfRow(row, games) === category);
    }

    const offset = (page - 1) * limit;
    const pageRows = collected.slice(offset, offset + limit);

    const names = await this.#namesFor(pageRows.map((r) => r.user_id));
    games ??= await this.#gameLabels(pageRows);

    return {
      rows: pageRows.map(({ gameCatalog, gameId, gameType, gameName, providerLabel, ...row }) => {
        const game = games.get(`${gameCatalog}:${gameId}`);
        return {
          ...row,
          user_name: names.get(row.user_id) ?? null,
          // The provider's id stays available under `game_uid`, because it is
          // what a support ticket names; `game_title` is what a column prints.
          game_uid: gameId,
          game_title: game?.name ?? gameName ?? gameId,
          // A game the catalog has no row for still came from somewhere, and
          // naming the aggregator beats an empty cell under the title.
          game_vendor: game?.vendor ?? providerLabel,
          /** original | live | slots — the player's Type filter (`categoryOf`). */
          game_category: this.#categoryOfRow({ gameCatalog, gameId, gameType, source_key: row.source_key }, games),
        };
      }),
      total: collected.length,
      truncated: collected.length >= MAX_ROWS_PER_SOURCE * wanted.length,
    };
  }

  /** @legacy GET /betHistory/transactions/user/:userId */
  async listForUser({ userId, staffId, ...rest }) {
    await this.#assertPlayerInTree({ staffId, userId });
    return this.list({ ...rest, userId, staffId });
  }

  /**
   * Read one source.
   *
   * Every source is normalised to the same fields here, which is what lets the
   * rest of the module — and the clients — stop caring which table a row came
   * from. `round` and `kind` are what let a caller rebuild a round out of the
   * legs the providers report separately: a Slotegrator spin arrives as a
   * `bet` row and a `win` row sharing a `round_id`, and reading `amount` alone
   * shows the stake and the payout as two unrelated lines.
   */
  /** `categoryOf` for a collected row: its catalogue entry, else the row's own game type. */
  #categoryOfRow(row, games) {
    const game = games.get(`${row.gameCatalog}:${row.gameId}`);
    return categoryOf({ sourceKey: row.source_key, vendor: game?.vendor, type: game?.type ?? row.gameType });
  }

  async #read(key, { visible, from, to, search, currency }) {
    const source = SOURCES[key];
    const model = this.models[source.model];

    // A service that does not load a domain simply contributes nothing, rather
    // than throwing. That keeps the report usable in a partial deployment.
    if (!model) return [];

    const where = {};
    Object.assign(where, this.#userWhere(visible, source.userColumn));

    if (from || to) {
      where[source.timeColumn] = {
        ...(from ? { [Op.gte]: from } : {}),
        ...(to ? { [Op.lte]: to } : {}),
      };
    }

    // Search matches the transaction reference. Player-name search is applied
    // after the join below, because the name lives in another service's table.
    if (search) where[source.idColumn] = { [Op.iLike]: `%${search}%` };

    // One coin, case-insensitively: `bets.coin` is stored lower-case, every other source
    // upper-case. The validator allows letters and digits only, so there is nothing to escape.
    if (currency) where[source.currencyColumn] = { [Op.iLike]: currency };

    const rows = await model.findAll({
      where,
      order: [[source.timeColumn, 'DESC']],
      limit: MAX_ROWS_PER_SOURCE,
      raw: true,
    });

    const legs = rows.map((row) => {
      const profit = row[source.profitColumn];
      const reference = String(row[source.idColumn] ?? '');
      const round = source.roundColumn ? row[source.roundColumn] : null;
      const kind = kindOf(source, row);

      return {
        id: row[source.rowIdColumn] != null ? Number(row[source.rowIdColumn]) : null,
        transaction_id: reference,
        // A source with no round of its own — jsGames v2 — reports movements
        // that stand alone, so the movement IS the round.
        round_id: round != null && round !== '' ? String(round) : reference,
        user_id: Number(row[source.userColumn]),
        session: source.sessionColumn ? (row[source.sessionColumn] ?? null) : null,
        /**
         * The direction, in ONE vocabulary — see `kindOf`. `BET` and `WIN` are
         * the two a Bet/Win column adds up; `ROUND` is an in-house row that is
         * already both, with the stake in `amount` and the win in `profit`.
         */
        transaction_type: kind,
        /**
         * The MAGNITUDE. Direction is `transaction_type`'s job, and a column
         * that prints "-3000" under a heading that says "Bet" reads as a
         * correction rather than a stake.
         */
        amount: this.#magnitude(row[source.amountColumn]),
        /** Signed, and for an in-house row this is the win on the stake. */
        profit: this.#decimal(profit),
        outcome: classify(profit),
        // `bets.coin` is stored lower-case and every other source stores it
        // upper-case; a player should not see `usdt` and `USDT` in one table.
        currency_code: row[source.currencyColumn]
          ? String(row[source.currencyColumn]).toUpperCase()
          : null,
        transaction_timestamp: row[source.timeColumn],
        // The provider's own word for what this was, before it was reconciled
        // into `transaction_type` — kept so a support agent can match a row
        // against what the provider's own dashboard shows.
        reason: source.kindColumn ? String(row[source.kindColumn] ?? '').toUpperCase() || null : kind,
        round_finished: finishedOf(source, row),
        /**
         * Every row here is one whose money moved: the record is written inside
         * the same database transaction as the balance change, so a row that
         * exists is a movement that was applied. Where a source keeps its own
         * status column, that is reported instead.
         */
        transaction_status: source.statusColumn
          ? String(row[source.statusColumn] ?? 'SUCCESS').toUpperCase()
          : 'SUCCESS',
        source: source.table,
        // What `?source=` takes; `source` itself is the table, as legacy named it.
        source_key: key,
        gameId: source.gameColumn ? (row[source.gameColumn] ?? null) : null,
        gameType: source.gameTypeColumn ? (row[source.gameTypeColumn] ?? null) : null,
        gameName: source.gameNameColumn ? (row[source.gameNameColumn] ?? null) : null,
        gameCatalog: source.catalog,
        providerLabel: source.label,
      };
    });
    return source.oneRowPerRound ? this.#foldRounds(legs) : legs;
  }

  /**
   * One row per round for a source whose legs are unsigned (`og`): the stake leg and the win
   * leg would otherwise both read as wins (profit = amount > 0). The round keeps the newest
   * leg's fields; `amount` is the stake, `profit` the win less the stake. A rolled-back round
   * nets to 0 (a push). A round with no win leg yet shows the stake as lost until the win lands.
   */
  #foldRounds(legs) {
    const rounds = new Map();
    for (const leg of legs) {
      const round = rounds.get(leg.round_id) ?? { row: leg, stake: 0n, win: 0n, settled: false, void: false };
      const minor = money.toMinorQuantised(leg.amount);
      if (leg.transaction_type === KIND.BET) round.stake += minor;
      else if (leg.transaction_type === KIND.WIN) {
        round.win += minor;
        round.settled = true;
      } else if (leg.transaction_type === KIND.REFUND || leg.transaction_type === KIND.ROLLBACK) round.void = true;
      rounds.set(leg.round_id, round);
    }
    return [...rounds.values()].map(({ row, stake, win, settled, void: rolledBack }) => {
      const profit = rolledBack ? 0n : win - stake;
      return {
        ...row,
        transaction_type: KIND.ROUND,
        amount: this.#decimal(money.toDecimalString(stake)),
        profit: this.#decimal(money.toDecimalString(profit)),
        outcome: classify(money.toDecimalString(profit)),
        reason: rolledBack ? 'ROLLBACK' : 'ROUND',
        round_finished: settled || rolledBack,
      };
    });
  }

  /**
   * A stored amount as a decimal string, at the platform's scale.
   *
   * `toMinorQuantised`, not `toMinor`: these columns hold rows legacy wrote
   * with float arithmetic, some carrying twenty decimal places, and a report
   * that 400s the whole page because one historical row is over-precise is
   * worse than one that shows it to eight places.
   */
  #decimal(value) {
    if (value === null || value === undefined || value === '') return '0';
    try {
      // `toDecimalString` pads to the platform's eight places, which is right
      // for a balance and noise in a history row — `19.84000000` where the
      // provider said `19.84`. Trailing zeros carry no value, so they go.
      return money.toDecimalString(money.toMinorQuantised(String(value)))
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '');
    } catch {
      // A column holding something that is not a number at all is a data
      // problem to see in the logs, not a reason to fail the page.
      this.logger?.warn({ value: String(value) }, 'Non-numeric amount in casino history');
      return '0';
    }
  }

  /** The same, with the sign dropped. */
  #magnitude(value) {
    const decimal = this.#decimal(value);
    return decimal.startsWith('-') ? decimal.slice(1) : decimal;
  }

  /**
   * Game names for a page of rows, one query per catalog.
   *
   * Keyed `catalog:id` because a Slotegrator uuid and a jsGames slug are
   * different namespaces and could collide.
   */
  async #gameLabels(rows) {
    const labels = new Map();
    const wanted = new Map();

    for (const row of rows) {
      if (!row.gameCatalog || !row.gameId) continue;
      if (!wanted.has(row.gameCatalog)) wanted.set(row.gameCatalog, new Set());
      wanted.get(row.gameCatalog).add(String(row.gameId));
    }

    for (const [key, ids] of wanted) {
      const catalog = CATALOGS[key];
      if (!catalog) continue;
      // The primary catalogue first, then the fallback for ids it does not know. A catalog this
      // deployment does not load leaves the raw id in place, which is worse than a name and
      // better than an empty column.
      for (const modelName of [catalog.model, catalog.fallbackModel]) {
        const model = modelName && this.models[modelName];
        const missing = [...ids].filter((id) => !labels.has(`${key}:${id}`));
        if (!model || !missing.length) continue;

        const found = await model.findAll({
          where: { [catalog.keyColumn]: { [Op.in]: missing } },
          attributes: [
            catalog.keyColumn,
            catalog.nameColumn,
            catalog.vendorColumn,
            ...(catalog.typeColumn ? [catalog.typeColumn] : []),
            ...(catalog.imageColumn ? [catalog.imageColumn] : []),
          ],
          raw: true,
        });

        for (const game of found) {
          labels.set(`${key}:${game[catalog.keyColumn]}`, {
            name: game[catalog.nameColumn] ?? null,
            vendor: game[catalog.vendorColumn] ?? null,
            type: catalog.typeColumn ? (game[catalog.typeColumn] ?? null) : null,
            image: catalog.imageColumn ? (game[catalog.imageColumn] ?? null) : null,
          });
        }
      }
    }

    return labels;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Aggregates
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /betHistory/transactions/stats
   *
   * Counts and net across every source, using ONE definition of win, loss and
   * push — see the class note.
   */
  async stats({ userId, staffId, from, to, channel, casinoOnly = false }) {
    const visible = await this.#visibleUserIds({ staffId, userId, channel });
    if (visible.empty) return this.#emptyStats();

    const totals = this.#emptyTotals();
    const bySource = {};
    /** The same figures per wallet: money in two coins does not add up raw. */
    const currencies = new Map();
    const dayRows = [];
    const add = (into, entry) => {
      for (const field of ['total', 'bets', 'wins', 'paidWins', 'pushes', 'losses', 'refunds']) into[field] += entry[field];
      for (const field of ['wagered', 'payouts', 'refunded', 'net']) {
        into[field] = money.toDecimalString(money.toMinorQuantised(into[field]) + money.toMinorQuantised(entry[field]));
      }
    };

    for (const key of casinoOnly ? CASINO_SOURCE_KEYS : SOURCE_KEYS) {
      const source = SOURCES[key];
      const model = this.models[source.model];
      if (!model) continue;

      const where = { ...this.#userWhere(visible, source.userColumn) };
      if (from || to) {
        where[source.timeColumn] = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };
      }

      // Built from the frozen SOURCES table, never from a request — which is
      // what makes these safe to hand to `literal()`.
      const stat = statExpressions(source);
      // The providers' names for this platform's wallets: PKR is INR, USD is USDT.
      const currency = `CASE UPPER(${source.currencyColumn}::text) WHEN 'PKR' THEN 'INR' WHEN 'USD' THEN 'USDT'
                          ELSE UPPER(COALESCE(${source.currencyColumn}::text, '?')) END`;

      const day = `TO_CHAR(DATE_TRUNC('day', ${source.timeColumn}), 'YYYY-MM-DD')`;
      const rows = await model.findAll({
        where,
        attributes: [[literal(currency), 'currency'], [literal(day), 'day'], ...Object.entries(stat).map(([name, sql]) => [literal(sql), name])],
        group: [literal('1'), literal('2')],
        raw: true,
      });

      const entry = this.#emptyTotals();
      for (const row of rows) {
        const one = this.#statEntry(row);
        add(entry, one);
        if (!currencies.has(row.currency)) currencies.set(row.currency, { totals: this.#emptyTotals(), bySource: {} });
        const wallet = currencies.get(row.currency);
        wallet.bySource[source.label] ??= this.#emptyTotals();
        add(wallet.bySource[source.label], one);
        add(wallet.totals, one);
        dayRows.push({ ...one, currency: row.currency, day: row.day });
      }

      bySource[source.label] = entry;
      add(totals, entry);
    }

    const byCurrency = [...currencies.entries()]
      .map(([currency, figures]) => ({ currency, ...figures }))
      .sort((a, b) => b.totals.bets - a.totals.bets);
    return { totals, bySource, byType: this.#byType(totals), byCurrency, usdt: await this.#inUsdt(dayRows) };
  }

  /**
   * Every wallet's figures valued in USDT at the site's current rates (exchangerate.usd_rate;
   * USDT is 1 USD), in total and per day. A coin with no rate is left out and named in `unconverted`.
   */
  async #inUsdt(dayRows) {
    const rates = new Map(
      (await this.models.Users.sequelize.query('SELECT UPPER(currency) AS currency, usd_rate FROM exchangerate', { type: QueryTypes.SELECT }))
        .map((r) => [r.currency, String(r.usd_rate)])
    );
    rates.set('USDT', '1');
    const blank = () => ({ bets: 0, wagered: '0', payouts: '0', ggr: '0' });
    const add = (into, r, rate) => {
      const usd = (v) => money.multiply(v, rate);
      into.bets += r.bets;
      into.wagered = money.toDecimalString(money.add(into.wagered, money.toDecimalString(usd(r.wagered))));
      into.payouts = money.toDecimalString(money.add(into.payouts, money.toDecimalString(usd(r.payouts))));
      into.ggr = money.toDecimalString(money.subtract(into.wagered, into.payouts));
    };
    const totals = blank();
    const days = new Map();
    const unconverted = new Set();
    for (const r of dayRows) {
      const rate = rates.get(r.currency);
      if (!rate) { unconverted.add(r.currency); continue; }
      if (!days.has(r.day)) days.set(r.day, { day: r.day, ...blank() });
      add(days.get(r.day), r, rate);
      add(totals, r, rate);
    }
    return { totals, days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)), unconverted: [...unconverted] };
  }

  /** One grouped `statExpressions` row as the totals shape. */
  #statEntry(row) {
    const dec = (v) => money.toDecimalString(money.toMinorQuantised(String(v ?? '0')));
    const wagered = dec(row?.wagered);
    const payouts = dec(row?.payouts);
    return {
      total: Number(row?.movements ?? 0),
      bets: Number(row?.bets ?? 0),
      /** Legacy's `total_wins`: every win row, zero-value ones included. */
      wins: Number(row?.winRows ?? 0),
      paidWins: Number(row?.paidWins ?? 0),
      pushes: Number(row?.pushes ?? 0),
      losses: Number(row?.losses ?? 0),
      refunds: Number(row?.refunds ?? 0),
      wagered,
      payouts,
      refunded: dec(row?.refunded),
      /** The PLAYERS' side: positive means the players are up on this source. */
      net: money.toDecimalString(money.toMinorQuantised(payouts) - money.toMinorQuantised(wagered)),
    };
  }

  /**
   * The same totals as a per-transaction-type list, which is how legacy's
   * `typeBreakdown` reported them and what the Transaction Breakdown panel
   * draws. Derived rather than queried again — one set of numbers, so the
   * panel can never disagree with the cards above it.
   */
  #byType(totals) {
    return [
      { type: 'win', count: totals.wins, amount: totals.payouts },
      { type: 'bet', count: totals.bets, amount: totals.wagered },
      { type: 'refund', count: totals.refunds, amount: totals.refunded },
    ]
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  #emptyTotals() {
    return {
      total: 0, bets: 0, wins: 0, paidWins: 0, pushes: 0, losses: 0, refunds: 0,
      wagered: '0', payouts: '0', refunded: '0', net: '0',
    };
  }

  /**
   * The caller's own headline counts, for their profile panel.
   *
   * ── WHY THIS IS NOT `stats()` ────────────────────────────────────────────
   *
   * `stats()` counts MOVEMENTS and reads `amount` as a signed profit. That
   * holds for the in-house table and for nothing else: the aggregators write a
   * stake row and a payout row per round, both positive. Asked for one player
   * with 405 Slotegrator spins it answers 931 bets and 931 wins.
   *
   * A player asking "how many bets have I placed" means rounds, so the counts
   * come from `countExpressions()` — see the note on it for the arithmetic.
   *
   * No money in the response, and no `wagered`. The four sources hold four
   * different currencies, and adding a PKR stake to a USDT one is the mistake
   * this module's class note already describes. The player's turnover has one
   * honest source, `userwager.wager`, which user-service already serves.
   *
   * No `staffId` either: this is always the caller's own row, resolved from
   * their token by the route.
   */
  async playerStats({ userId }) {
    const totals = { bets: 0, wins: 0 };
    const bySource = {};

    for (const key of SOURCE_KEYS) {
      const source = SOURCES[key];
      const model = this.models[source.model];
      // A source this deployment does not load contributes nothing, rather
      // than failing the whole panel.
      if (!model) continue;

      const counts = countExpressions(source);

      const [row] = await model.findAll({
        where: { [source.userColumn]: userId },
        attributes: [
          [literal(counts.stakes), 'bets'],
          [literal(counts.paidWins), 'wins'],
        ],
        raw: true,
      });

      const entry = { bets: Number(row?.bets ?? 0), wins: Number(row?.wins ?? 0) };
      bySource[source.label] = entry;
      totals.bets += entry.bets;
      totals.wins += entry.wins;
    }

    return { ...totals, bySource };
  }

  /**
   * @legacy GET /betHistory/user/:userId/bet-win-count
   *
   * One player's bet and win counts.
   */
  async betWinCount({ userId, staffId }) {
    await this.#assertPlayerInTree({ staffId, userId });
    const visible = await this.#visibleUserIds({ staffId, userId });
    if (visible.empty) return { userId, bets: 0, wins: 0, bySource: {} };

    const { totals, bySource } = await this.stats({ userId, staffId });
    return { userId, bets: totals.total, wins: totals.wins, bySource };
  }

  /**
   * @legacy GET /betHistory/admin/analytics
   *
   * The dashboard summary: all time, today, by outcome, and the busiest
   * players.
   */
  async analytics({ staffId, channel, casinoOnly = false }) {
    const visible = await this.#visibleUserIds({ staffId, channel });
    if (visible.empty) {
      return { ...this.#emptyStats(), today: null, topUsers: [] };
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [allTime, today, topUsers] = await Promise.all([
      this.stats({ staffId, channel, casinoOnly }),
      this.stats({ staffId, from: startOfDay, channel, casinoOnly }),
      this.#topUsers(visible, 10, null, casinoOnly),
    ]);

    return {
      totals: allTime.totals,
      bySource: allTime.bySource,
      byType: allTime.byType,
      today: today.totals,
      topUsers,
    };
  }

  /**
   * The busiest players in the visible tree, across every source.
   *
   * ── WHY THIS IS NOT IN-HOUSE ONLY ANY MORE ───────────────────────────────
   *
   * It read the in-house `bets` table alone, on the reasoning that legacy
   * summed a UNION of four tables whose `amount` columns hold different
   * currencies — a USDT stake added to an INR one — and so ranked nobody
   * meaningfully. The reasoning is right about the MONEY and wrong as a
   * remedy: a deployment whose casino is entirely Slotegrator has no in-house
   * rows at all, so the panel rendered "No data yet" beside 28,240 movements
   * it could see perfectly well. A leaderboard that is empty is not more
   * honest than one that is approximate; it just says nothing.
   *
   * Both halves can be had. RANKING is by stake COUNT, which has no currency
   * and is exact across any mix of sources. The MONEY is summed per source and
   * the sources that contributed are NAMED in `scope`, so a reader can see
   * what went into the figure instead of being told to assume.
   */
  async #topUsers(visible, limit = 10, from = null, casinoOnly = false) {
    const { ranked, scope } = await this.#rankUsers(visible, from, casinoOnly);
    const top = ranked.slice(0, limit);
    const names = await this.#namesFor(top.map(([id]) => id));

    return top.map(([id, entry]) => ({
      userId: id,
      userName: names.get(id) ?? null,
      bets: entry.bets,
      wagered: String(entry.wagered),
      won: String(entry.won),
      scope,
    }));
  }

  /**
   * Every player ranked, unsliced — extracted from `#topUsers` so the public
   * leaderboard and a player's own POSITION can share one aggregation. A
   * position cannot be read off a top ten: the whole point of asking is that
   * you are not in it.
   *
   * `from` narrows every source by its OWN time column, which differs per
   * source (`bets.created`, `gis_transactions.created_at`, …) — that is why it
   * is read from `SOURCES` rather than assumed.
   */
  async #rankUsers(visible, from = null, casinoOnly = false) {
    const perUser = new Map();
    const contributing = [];

    for (const key of casinoOnly ? CASINO_SOURCE_KEYS : SOURCE_KEYS) {
      const source = SOURCES[key];
      const model = this.models[source.model];
      if (!model) continue;

      const stat = statExpressions(source);
      const where = {
        ...this.#userWhere(visible, source.userColumn),
        ...(from && source.timeColumn ? { [source.timeColumn]: { [Op.gte]: from } } : {}),
      };

      const rows = await model.findAll({
        where,
        attributes: [
          [col(source.userColumn), 'userId'],
          [literal(stat.bets), 'bets'],
          [literal(stat.wagered), 'wagered'],
          [literal(stat.payouts), 'payouts'],
        ],
        group: [source.userColumn],
        // Ranked in JS once every source is in — a per-source top ten would
        // drop a player who is eleventh everywhere and first overall.
        raw: true,
      });

      if (rows.length) contributing.push(source.label);

      for (const row of rows) {
        const id = Number(row.userId);
        if (!Number.isFinite(id)) continue;
        if (!perUser.has(id)) perUser.set(id, { bets: 0, wagered: 0, won: 0 });
        const entry = perUser.get(id);
        entry.bets += Number(row.bets ?? 0);
        entry.wagered += Number(row.wagered ?? 0);
        entry.won += Number(row.payouts ?? 0);
      }
    }

    const ranked = [...perUser.entries()].sort(
      (a, b) => b[1].bets - a[1].bets || b[1].wagered - a[1].wagered
    );

    return { ranked, scope: contributing.length ? contributing.join(', ') : 'no sources' };
  }

  /**
   * @legacy GET /live-bets
   *
   * The public ticker. Player ids are NOT exposed — legacy answered with
   * `SELECT *` from `bets`, which put every player's id and full row on a page
   * anyone could load.
   */
  /**
   * Who is playing what, right now.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THIS IS THE "N PLAYING" NUMBER, AND NOTHING ELSE COULD ANSWER IT
   *
   * `BACKEND-GAP-REPORT.md` §6 item 4 proposed `casino/games/stats` for the
   * per-tile player counts. That route counts the CATALOGUE —
   * `total_games`, `total_providers`, `total_types` — and cannot answer
   * "how many people are on this game". The live ticker below is the closest
   * thing that existed, and it is a list of bets with no player on it (by
   * design: it is public).
   *
   * So this counts DISTINCT players with a settled round on each game inside a
   * recent window. That is a real activity number rather than a proxy for one.
   *
   * ── IT IS AN AGGREGATE, WHICH IS WHY IT CAN BE PUBLIC ────────────────
   *
   * `COUNT(DISTINCT uid)` — the ids do the grouping and never leave the
   * database. The ticker below had to strip the player off every row to be
   * publishable; there is nothing here to strip.
   *
   * Same `where` as the ticker: an open round has no outcome and a refunded
   * one never happened, so neither is somebody playing.
   * ═══════════════════════════════════════════════════════════════════════
   */
  async activity({ minutes }) {
    const since = new Date(Date.now() - minutes * 60_000);

    const rows = await this.models.Bets.findAll({
      where: {
        created: { [Op.gte]: since },
        [Op.and]: literal(`"result" IS NOT NULL AND "result"::text <> '"refunded"'`),
      },
      attributes: [
        'game',
        [fn('COUNT', fn('DISTINCT', col('uid'))), 'players'],
        [fn('COUNT', col('id')), 'rounds'],
      ],
      group: ['game'],
      order: [[fn('COUNT', fn('DISTINCT', col('uid'))), 'DESC']],
      raw: true,
    });

    const games = rows
      .filter((row) => row.game)
      .map((row) => ({
        game: row.game,
        players: Number(row.players) || 0,
        rounds: Number(row.rounds) || 0,
      }));

    return {
      windowMinutes: minutes,
      since: since.toISOString(),
      /**
       * The platform total is NOT the sum of the per-game counts — one player
       * on three games is three of those and one of these. Counted separately
       * rather than added up, because a lobby header showing the sum would
       * inflate itself every time somebody switched game.
       */
      players: await this.#distinctPlayersSince(since),
      games,
    };
  }

  /**
   * The games this player last played — the "Continue Playing" row.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * WHY THIS EXISTS BESIDE `casino/games/recently-played`
   *
   * That route is the right one and it is not going away: it reads
   * `gis_recently_played`, which the GIS provider flow writes when a player
   * opens a provider game. On a deployment with those credentials it is the
   * answer.
   *
   * It is also **permanently empty for in-house games**, and always will be:
   * nothing in the in-house engine writes to that table. Twenty of the
   * twenty-two originals are played over the casino socket and the only trace
   * they leave is a row in `bets`. So on this platform — where the aggregator
   * is unconfigured (§5.2) and the originals are the whole catalogue —
   * `recently-played` answers `[]` for every player who has ever played.
   *
   * This is the same question asked of the table that actually has the rows.
   * The client tries the provider route first and falls back to this, so both
   * kinds of game appear in one row and neither needs the other configured.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Scoped to the caller — there is no parameter for a player id, like
   * everything else on this router.
   */
  async recentGames({ userId, limit }) {
    const rows = await this.models.Bets.findAll({
      where: {
        uid: userId,
        /* Same rule as the ticker and `activity`: an open round has no outcome
           and a refunded one never happened, so neither is something the
           player played. */
        [Op.and]: literal(`"result" IS NOT NULL AND "result"::text <> '"refunded"'`),
      },
      attributes: [
        'game',
        [fn('MAX', col('created')), 'last_played'],
        [fn('COUNT', col('id')), 'rounds'],
      ],
      group: ['game'],
      /* Most recently played first — which is what "continue" means. */
      order: [[fn('MAX', col('created')), 'DESC']],
      limit,
      raw: true,
    });

    return {
      games: rows
        .filter((row) => row.game)
        .map((row) => ({
          game: row.game,
          lastPlayedAt: row.last_played,
          rounds: Number(row.rounds) || 0,
        })),
    };
  }

  /** DISTINCT players across every game in the window. See `activity`. */
  async #distinctPlayersSince(since) {
    const [row] = await this.models.Bets.findAll({
      where: {
        created: { [Op.gte]: since },
        [Op.and]: literal(`"result" IS NOT NULL AND "result"::text <> '"refunded"'`),
      },
      attributes: [[fn('COUNT', fn('DISTINCT', col('uid'))), 'players']],
      raw: true,
    });
    return Number(row?.players) || 0;
  }

  async liveFeed({ limit }) {
    const rows = await this.models.Bets.findAll({
      /**
       * ═══════════════════════════════════════════════════════════════════
       * VOIDED AND OPEN ROUNDS ARE NOT PUBLIC RESULTS
       *
       * This had no `where` at all, so the ticker showed two kinds of row it
       * should not:
       *
       *   `result IS NULL`        a round still open — no outcome yet, and
       *                           publishing one implies there is.
       *   `result = "refunded"`   a round the engine VOIDED and gave the
       *                           stake back (`GameEngine.refund`). Its
       *                           `profit` is `0`, and `classify()` reads a
       *                           zero profit as `PUSH` — so a bet that never
       *                           happened appeared publicly as a tie.
       *
       * Nine such rows existed here at the time of writing, all from rejected
       * Single Keno cards (§8.8). `result` is a `json` column and the marker
       * is stored as the JSON string `"refunded"`, hence the `::text` compare
       * rather than an equality on the column.
       * ═══════════════════════════════════════════════════════════════════
       */
      where: literal(`"result" IS NOT NULL AND "result"::text <> '"refunded"' AND ${NOT_FAKE}`),
      attributes: ['gid', 'amount', 'profit', 'coin', 'created', 'game'],
      order: [['created', 'DESC']],
      limit,
      raw: true,
    });

    const inHouse = rows.map((row) => ({
      reference: String(row.gid),
      game: row.game ?? null,
      amount: String(row.amount ?? '0'),
      profit: String(row.profit ?? '0'),
      outcome: classify(row.profit),
      currency: row.coin ?? null,
      at: row.created,
      category: 'original',
    }));

    // Third-party rounds too: the ticker showed only in-house games (on live, only Limbo).
    const provider = (await this.#providerRounds()).map(({ win, ...round }) => round);
    return [...inHouse, ...provider]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);
  }

  /**
   * Third-party rounds for the public ticker and top wins — one row per finished round, no
   * player. A provider writes a round as legs (bet, win, …); they are folded here by round:
   *
   *   jsgamesv2  every leg carries the round's own `bet_amount` / `win_amount` in
   *              `additional_data`, keyed by `game_round`, so those are read as-is;
   *   gis/js v1  legs summed: BET → stake, WIN → payout, NET (v1 settle) → signed profit;
   *              a REFUND or ROLLBACK voids the round.
   *
   * A round with only its stake so far is still open (a crash round in flight) unless it is
   * older than OPEN_ROUND_GRACE_MS — a losing v2 spin never gets a second leg.
   *
   * shortcut: reads each table's newest MAX_ROWS_PER_SOURCE legs, so top wins ranks RECENT
   * provider rounds; an indexed rounds table is the upgrade if all-time tops are wanted.
   */
  async #providerRounds() {
    const rounds = new Map();
    const settledBefore = Date.now() - OPEN_ROUND_GRACE_MS;

    for (const key of SOURCE_KEYS) {
      if (key === 'inhouse') continue;
      const source = SOURCES[key];
      const model = this.models[source.model];
      if (!model) continue;

      const legs = await model.findAll({
        order: [[source.timeColumn, 'DESC']],
        limit: MAX_ROWS_PER_SOURCE,
        raw: true,
      });

      for (const leg of legs) {
        const extra = leg.additional_data && typeof leg.additional_data === 'object' ? leg.additional_data : null;
        const v2 = key === 'jsgamesv2' && extra && extra.bet_amount != null;
        const roundId = v2 ? extra.game_round : source.roundColumn ? leg[source.roundColumn] : null;
        const id = `${key}:${roundId ?? leg[source.idColumn]}`;
        const at = leg[source.timeColumn];
        const round = rounds.get(id) ?? {
          reference: String(roundId ?? leg[source.idColumn] ?? ''),
          sourceKey: key,
          gameCatalog: source.catalog,
          gameId: leg[source.gameColumn] ?? null,
          gameName: source.gameNameColumn ? (leg[source.gameNameColumn] ?? null) : null,
          currency: leg[source.currencyColumn] ? String(leg[source.currencyColumn]).toUpperCase() : null,
          at,
          stake: 0,
          win: 0,
          net: 0,
          settled: false,
          void: false,
        };
        if (new Date(at) > new Date(round.at)) round.at = at;

        const kind = kindOf(source, leg);
        const amount = Math.abs(Number(leg[source.amountColumn] ?? 0)) || 0;
        if (v2) {
          round.stake = Math.max(round.stake, Number(extra.bet_amount) || 0);
          round.win = Math.max(round.win, Number(extra.win_amount) || 0);
          if (kind !== KIND.BET) round.settled = true;
        } else if (kind === KIND.BET) {
          round.stake += amount;
        } else if (kind === KIND.WIN) {
          round.win += amount;
          round.settled = true;
        } else if (kind === KIND.NET) {
          round.net += Number(leg[source.amountColumn] ?? 0) || 0;
          round.settled = true;
        } else if (kind === KIND.REFUND || kind === KIND.ROLLBACK) {
          round.void = true;
        }
        if (finishedOf(source, leg) === true) round.settled = true;
        rounds.set(id, round);
      }
    }

    const finished = [...rounds.values()].filter(
      (r) => !r.void && r.stake > 0 && (r.settled || new Date(r.at).getTime() < settledBefore),
    );
    const names = await this.#gameLabels(finished);

    return finished.map((r) => {
      const profit = r.win - r.stake + r.net;
      const label = names.get(`${r.gameCatalog}:${r.gameId}`);
      return {
        reference: r.reference,
        game: r.gameId,
        title: label?.name ?? r.gameName ?? null,
        // The lobby tile's art and its original | live | slots tab, for the home widgets.
        image: label?.image ?? null,
        category: categoryOf({ sourceKey: r.sourceKey, vendor: label?.vendor, type: label?.type }),
        amount: this.#decimal(r.stake),
        profit: this.#decimal(profit),
        outcome: classify(profit),
        currency: r.currency,
        at: r.at,
        win: profit,
      };
    });
  }

  /**
   * The wager contest leaderboard — gap 7.
   *
   * ── THE DATA ALWAYS EXISTED; ONLY A PUBLIC ROUTE DID NOT ───────────────
   *
   * `#rankUsers` is the operator panel's own aggregation, and it is used here
   * unchanged: RANKED BY STAKE COUNT, which has no currency and is therefore
   * exact across a mix of sources, with the money summed per source and the
   * contributing sources NAMED in `scope`. That reasoning is written out above
   * `#topUsers` and applies identically to a public board — a leaderboard that
   * adds a USDT stake to an INR one is approximate, and saying which sources
   * went into it is what keeps it honest rather than pretending otherwise.
   *
   * ── NAMES ARE MASKED, NOT RESOLVED ────────────────────────────────────
   *
   * The staff version resolves usernames and should. This is the public
   * audience, where `liveFeed` names nobody at all — and a leaderboard with no
   * identity is not a leaderboard, so the middle course is a masked handle:
   * first two characters and a length-preserving tail. It is enough to
   * recognise yourself and not enough to enumerate the player list. An
   * operator who wants full names is making a privacy decision and should make
   * it deliberately, here, in `#maskName`.
   */
  async leaderboard({ period, limit }) {
    const from = periodStart(period);
    const { ranked, scope } = await this.#rankUsers({ all: true }, from);

    return {
      period,
      from,
      scope,
      total: ranked.length,
      rows: ranked.slice(0, limit).map(([id, entry], i) => ({
        rank: i + 1,
        player: this.#maskName(id),
        bets: entry.bets,
        wagered: String(entry.wagered),
        won: String(entry.won),
      })),
    };
  }

  /**
   * Where the caller sits on that board.
   *
   * A separate read rather than a flag on the list, because the answer is
   * usually "not in the top N" and that is exactly when it is worth asking.
   * `rank` is `null` for a player who has not bet in the window — which is not
   * the same as last place and should not render as a number.
   */
  async myPosition({ userId, period }) {
    const from = periodStart(period);
    const { ranked, scope } = await this.#rankUsers({ all: true }, from);

    const index = ranked.findIndex(([id]) => String(id) === String(userId));
    if (index === -1) {
      return { period, from, scope, rank: null, total: ranked.length, bets: 0, wagered: '0', won: '0' };
    }

    const [, entry] = ranked[index];
    return {
      period,
      from,
      scope,
      rank: index + 1,
      total: ranked.length,
      bets: entry.bets,
      wagered: String(entry.wagered),
      won: String(entry.won),
    };
  }

  /**
   * A recognisable handle that is not the username.
   *
   * Derived from the ID, not the name: deriving it from the name would leak
   * the name's length and its first characters, and two players whose names
   * share a prefix would collide into one visible handle. The id is already
   * public in the sense that it is the player's own, and this is a one-way
   * shortening of it rather than the id itself.
   */
  #maskName(userId) {
    const digits = String(userId);
    return `Player ${digits.slice(-4)}`;
  }

  /**
   * ONE of the caller's own bets — gap 18.
   *
   * The only route that could read a single bet was the INTERNAL
   * player/:userId/bets/:betId one below, which the gateway blocks, so a row in
   * the player's own history had nothing to open.
   *
   * (Named in prose on purpose. `tools/verify-internal-acl.js` scans every file for
   * an internal path inside quotes OR BACKTICKS and treats each hit as a call the
   * enclosing service makes — so quoting one in a comment made the tool report that
   * casino-service calls itself and fails its own ACL. A doc comment should not be
   * able to fail a build. Naming it without delimiters is the cheap half of the fix;
   * teaching that regex to skip comments is the other half, and is not done here.)
   *
   * ── THE OWNERSHIP CHECK IS IN THE `where`, NOT AFTER THE READ ──────────
   *
   * `{ id, uid: userId }` rather than fetching by id and comparing — a
   * comparison is a line someone can delete, and this shape cannot return a
   * row it should not. A bet belonging to somebody else and a bet that does
   * not exist give the same `null`, so ids cannot be walked to learn what
   * other people staked.
   */
  async myBet({ userId, betId }) {
    const row = await this.models.Bets.findOne({
      where: { id: betId, uid: userId },
      raw: true,
    });

    if (!row) return null;

    return {
      id: String(row.id),
      reference: row.gid == null ? null : String(row.gid),
      game: row.game ?? null,
      currency: row.coin ?? null,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      profit: money.toDecimalString(money.toMinor(row.profit ?? '0')),
      outcome: classify(row.profit),
      /* The provably-fair pair. `hash` is the server seed's hash and `result`
         the round's outcome; both are null until the round settles. */
      hash: row.hash ?? null,
      result: row.result ?? null,
      at: row.created,
    };
  }

  /**
   * The public big-wins board — gap 13.
   *
   * ── NO PLAYER IDENTITY, WHICH IS THIS PLATFORM'S OWN STANDARD ──────────
   *
   * `liveFeed` above is the precedent and it names nobody: legacy's version
   * answered `SELECT *` from `bets` and put every player's id on a page anyone
   * could load. The internal `/top-winners` DOES resolve names, and correctly —
   * it is staff-facing. This is the same query at the public audience, so the
   * name does not come with it.
   *
   * The front-end already expects that: `HIDDEN_NAME` is `'****'` and
   * `displayName` renders it as "Hidden", which is what bc.game's own ticker
   * shows. An operator who wants real names on this board is making a privacy
   * decision and should make it deliberately, here.
   */
  async topWins({ limit, game }) {
    const rows = await this.models.Bets.findAll({
      where: {
        profit: { [Op.gt]: 0 },
        ...(game ? { game } : {}),
        [Op.and]: literal(NOT_FAKE),
      },
      attributes: ['gid', 'game', 'amount', 'profit', 'coin', 'created'],
      order: [['profit', 'DESC']],
      limit,
      raw: true,
    });

    const inHouse = rows.map((row) => ({
      reference: row.gid == null ? null : String(row.gid),
      game: row.game ?? null,
      amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
      profit: money.toDecimalString(money.toMinor(row.profit ?? '0')),
      currency: row.coin ?? null,
      at: row.created,
      category: 'original',
    }));

    const provider = (await this.#providerRounds())
      .filter((r) => r.win > 0 && (!game || r.game === game))
      .map(({ win, outcome, ...round }) => round);
    return [...inHouse, ...provider]
      .sort((a, b) => Number(b.profit) - Number(a.profit))
      .slice(0, limit);
  }

  /**
   * @legacy GET /bet30, GET /bet1
   *
   * A player's own rounds in the timed games. Legacy read `?id=` from the query
   * with no authentication, so any player's history was one request away.
   */
  async myTimedRounds({ userId, interval, limit }) {
    const model = { '30s': this.models.Bets30s, '1m': this.models.Bets1m, '2m': this.models.Bets2m }[interval];
    if (!model) return [];

    /**
     * ORDERED BY `sessionid`, NOT BY `id` — THIS ROUTE ANSWERED 500 FOR EVERY
     * INTERVAL UNTIL IT WAS.
     *
     * `bets_30s`, `bets_1m` and `bets_2m` are each exactly
     * `uid, value, amount, sessionid, status, cointype`. There is no `id`, and
     * that is deliberate rather than an oversight: the generated models call
     * `removeAttribute('id')` with the note "This table has no primary key in
     * the schema; drop Sequelize's implicit id so generated SQL matches the
     * real columns." So the old `order: [['id','DESC']]` named a column the
     * model had explicitly dropped and the table never had, and Postgres
     * refused the whole statement with `column "id" does not exist` — a 500
     * on `GET /casino/bet-history/timed-rounds` for `30s`, `1m` and `2m`
     * alike, with no argument that worked.
     *
     * `sessionid` is the only column that identifies a round, so it is the
     * only ordering available. TWO THINGS TO KNOW BEFORE RELYING ON IT:
     *
     *   IT IS A LEXICAL SORT. The column is `varchar(250)`, so if a writer
     *   ever stores bare counters then '9' sorts after '10'. Whoever adds that
     *   writer should either zero-pad the id or add a column worth ordering
     *   on; this is deterministic, which is the most that can be said for it
     *   and is strictly better than the arbitrary order no ORDER BY would give
     *   a LIMIT.
     *
     *   THERE IS NO WRITER. Nothing in this delivery inserts into any of the
     *   three tables — checked across `services/`. So the route answers `[]`
     *   for every account today, and it is the same shape of gap as
     *   `gis_recently_played` and `VaultInterestHistory`: a read whose
     *   producer does not exist yet.
     */
    return model.findAll({
      /**
       * `String(userId)` — THE SECOND OF THE TWO DEFECTS ON THIS ROUTE, and it
       * survived the first fix.
       *
       * `uid` is `varchar(250)` on all three tables while `req.user.id` is a
       * bigint, so Sequelize bound a number against a text column and Postgres
       * refused with `operator does not exist: character varying = bigint` —
       * another 500, with the ORDER BY already corrected. The KYC module casts
       * for exactly this reason (`where: { user_id: String(userId) }`); these
       * legacy tables keep every column as text and every reader has to.
       */
      where: { uid: String(userId) },
      order: [['sessionid', 'DESC']],
      limit,
      raw: true,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Scoping
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Which players this caller may see.
   *
   * `staffId` comes from a verified staff token. The tree is resolved by
   * admin-service, which owns `staff` — casino-service does not load that model
   * and must not reach across for it.
   *
   * Returns `{all: true}` for a root operator, `{ids}` for anyone else, or
   * `{empty: true}` when the answer is "nobody", which every caller must treat
   * as an empty result rather than as no filter. Legacy's equivalent produced
   * `[-1]` and relied on nothing matching it.
   */
  /**
   * A per-player route (`/transactions/user/:userId`, `/user/:userId/bet-win-count`)
   * about a player outside the caller's tree is a 404, like every other
   * per-player staff route — not a 200 with zero rows, which reads as "this
   * player never bet". 404 rather than 403 so the answer does not confirm the
   * id exists. Player-scoped calls (no `staffId`) are already their own id.
   */
  async #assertPlayerInTree({ staffId, userId }) {
    if (!staffId) return;
    const visible = await this.#visibleUserIds({ staffId, userId });
    if (visible.empty) throw errors.PLAYER_NOT_IN_YOUR_TREE({ userId: String(userId) });
  }

  /**
   * `visible` → Sequelize where on a player column. `text`: column VARCHAR hai (`user_code`,
   * `bets_2m.uid`). `visible.channel` (root operator + Direct / Agent tab) = users ka subquery,
   * taaki lakhon ids ki list na banani pade. Literal sirf in do fixed strings se banta hai.
   */
  #userWhere(visible, column, { text = false } = {}) {
    if (visible.all) return {};
    if (visible.channel) {
      const id = text ? 'id::text' : 'id';
      const parent = visible.channel === 'direct' ? 'IS NULL' : 'IS NOT NULL';
      return { [column]: { [Op.in]: literal(`(SELECT ${id} FROM users WHERE parent_staff_id ${parent})`) } };
    }
    return { [column]: { [Op.in]: text ? visible.ids.map(String) : visible.ids } };
  }

  /**
   * Direct / Agent tab (`channel`): direct = `users.parent_staff_id IS NULL`, agent = NOT NULL.
   * Na ho = pehle jaisa. Root ke alawa kisi ke tree me direct user hota hi nahi.
   */
  async #visibleUserIds({ staffId, userId, channel }) {
    const visible = await this.#visibleUserIdsAll({ staffId, userId });
    if (!channel || visible.empty) return visible;

    if (visible.all) return { all: false, channel };
    if (userId) {
      const row = await this.models.Users.findByPk(Number(userId), { attributes: ['parent_staff_id'], raw: true });
      const direct = row ? row.parent_staff_id == null : null;
      return row && direct === (channel === 'direct') ? visible : { empty: true };
    }
    // Tree ke players ka parent hamesha set hai — sab agent wale.
    return channel === 'agent' ? visible : { empty: true };
  }

  async #visibleUserIdsAll({ staffId, userId }) {
    if (!staffId) {
      // A player-scoped call: exactly one id, and it came from their token.
      return userId ? { all: false, ids: [Number(userId)] } : { empty: true };
    }

    const { ids: staffIds } = await this.clients.admin.get(
      `/internal/admin/staff-directory/staff/${staffId}/descendants`
    );

    /**
     * The root operator sees everything, including rows whose owner is null.
     *
     * Legacy reached the same conclusion by checking `ids.includes(1)` — a
     * hard-coded id — on a tree derived from an unauthenticated header.
     */
    if (this.#isRoot(staffIds)) {
      // The root operator may see every player — but a question about ONE
      // player is still about that player. Returning `all` here dropped the
      // filter, so a player's detail page showed the whole platform's rounds
      // (and bet/win counts) under that player's id.
      return userId ? { all: false, ids: [Number(userId)] } : { all: true, ids: [] };
    }

    const players = await this.models.Users.findAll({
      where: { parent_staff_id: { [Op.in]: staffIds } },
      attributes: ['id'],
      raw: true,
    });

    if (!players.length) return { empty: true };

    const ids = players.map((p) => Number(p.id));

    // A staff member asking about one player may only be told about a player
    // in their own tree.
    if (userId) {
      const asked = Number(userId);
      return ids.includes(asked) ? { all: false, ids: [asked] } : { empty: true };
    }

    return { all: false, ids };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Sports bets, and the raw tables
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /betHistory/user/bet-history
   * @legacy GET /betHistory/admin/bet-history
   *
   * NOT SERVED HERE — see `services/sports/src/modules/bet-admin`.
   *
   * Both legacy routes lived under `/betHistory`, which is otherwise casino,
   * but they read `"SportsBet"` — a table sports-service owns. casino-service
   * does not load the `sports` model domain and should not start: a service
   * reaching into another's tables is the thing this port exists to undo.
   *
   * They are implemented against the same visibility rules in
   * `betAdmin.service.js`, which already serves five neighbouring routes over
   * the same table.
   */

  /**
   * @legacy GET /betHistory/transactions/luckysports
   *
   * The LuckySports feed, from `transaction_live`.
   */
  async luckySports({ staffId, userId, from, to, page = 1, limit = 20, channel }) {
    // Same table, same shape as the raw `live` read — with player names.
    const result = await this.rawTransactions({ table: 'live', staffId, userId, from, to, page, limit, channel });
    if (!result.rows.length) return result;

    const names = await this.#namesFor(result.rows.map((r) => r.userId));
    return {
      ...result,
      rows: result.rows.map((row) => ({ ...row, user: names.get(Number(row.userId)) ?? null })),
    };
  }

  /**
   * @legacy GET /transaction/live
   * @legacy GET /transaction/slot
   *
   * The two raw provider transaction tables.
   *
   * Legacy served both with no authentication and no scoping — the whole table.
   */
  async rawTransactions({ table, staffId, userId, from, to, page = 1, limit = 20, channel }) {
    const visible = await this.#visibleUserIds({ staffId, userId, channel });
    if (visible.empty) return { total: 0, rows: [] };

    const model = table === 'slot' ? this.models.TransactionSlot : this.models.TransactionLive;

    /**
     * The real schema: `id, method, user_code, user_balance, game_type,
     * provider_code, game_code, type, bet_money, win_money, txn_id, txn_type`.
     *
     * The player is `user_code` — a VARCHAR holding the player's id as a
     * string (the catalogue launches with `userCode: String(player.id)`), so
     * the scope is matched as strings. There is NO timestamp column, so
     * `from`/`to` cannot be applied and are ignored; `id` order is insertion
     * order. Reading `user_id` / `created_at` — which these tables never had —
     * was a 500 on every call.
     */
    void from;
    void to;
    const { rows, count } = await model.findAndCountAll({
      where: this.#userWhere(visible, 'user_code', { text: true }),
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    /**
     * `bet_money` / `win_money` are BIGINT, so every amount legacy wrote here
     * was already rounded to a whole unit at write time. Read as-is.
     */
    const amount = (v) => money.toDecimalString(money.toMinor(v ?? '0'));

    return {
      total: count,
      rows: rows.map((row) => ({
        id: String(row.id),
        at: null,
        userId: row.user_code != null ? String(row.user_code) : null,
        txnId: row.txn_id ?? null,
        type: row.type ?? row.txn_type ?? null,
        txnType: row.txn_type ?? null,
        method: row.method ?? null,
        gameType: row.game_type ?? null,
        provider: row.provider_code ?? null,
        game: row.game_code ?? null,
        amount: amount(row.bet_money),
        bet: amount(row.bet_money),
        win: amount(row.win_money),
        balance: row.user_balance != null ? amount(row.user_balance) : null,
        status: null,
      })),
    };
  }

  /**
   * @legacy GET /bets
   * @legacy GET /bet2
   *
   * The in-house `bets` and `bets_2m` tables.
   *
   * ─────────────────────────────────────────────────────────────────────
   *     server.get('/bets', async (req, res) => {
   *       const result = await pg.query('SELECT * FROM bets');
   *       res.json(result.rows);
   *     });
   *
   * Unauthenticated, unscoped, unpaginated: every bet ever placed by every
   * player, in one response. `/bet2` was the same with `?id=` off the query
   * string and no check that the caller owned it.
   * ─────────────────────────────────────────────────────────────────────
   */
  async houseBets({ table = 'bets', staffId, userId, from, to, page = 1, limit = 20, channel }) {
    const visible = await this.#visibleUserIds({ staffId, userId, channel });
    if (visible.empty) return { total: 0, rows: [] };

    if (table === 'bets_2m') return this.#bets2m({ visible, page, limit });

    const { rows, count } = await this.models.Bets.findAndCountAll({
      where: {
        ...this.#userWhere(visible, 'uid'),
        ...this.#dateWhere('created', from, to),
      },
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.uid));

    return {
      total: count,
      rows: rows.map((row) => ({
        id: String(row.id),
        at: row.created ?? null,
        userId: row.uid != null ? String(row.uid) : null,
        user: names.get(Number(row.uid)) ?? null,
        amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
        profit: money.toDecimalString(money.toMinor(row.profit ?? '0')),
        game: row.game ?? null,
      })),
    };
  }

  /**
   * `bets_2m` is not shaped like `bets`. Its only columns are
   * `uid VARCHAR, value, amount, sessionid, status, cointype` — no id, no
   * timestamp, no profit — so the `bets` query (ORDER BY id, WHERE created,
   * uid IN numbers) was a 500 on every call.
   *
   * Scope is matched against `uid` as strings. There is no date column, so
   * `from`/`to` are ignored for this table; rows are ordered by `sessionid`,
   * the closest thing it has to a stable key. `amount` is VARCHAR and is
   * passed through as stored when it is not a number.
   */
  async #bets2m({ visible, page, limit }) {
    const { rows, count } = await this.models.Bets2m.findAndCountAll({
      where: this.#userWhere(visible, 'uid', { text: true }),
      order: [['sessionid', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.uid).filter((u) => /^\d+$/.test(String(u ?? ''))));
    const decimal = (v) => {
      if (v === null || v === undefined || v === '') return null;
      try {
        return money.toDecimalString(money.toMinorQuantised(String(v).trim()));
      } catch {
        return String(v);
      }
    };

    return {
      total: count,
      rows: rows.map((row) => ({
        id: row.sessionid ?? null,
        at: null,
        userId: row.uid != null ? String(row.uid) : null,
        user: names.get(Number(row.uid)) ?? null,
        amount: decimal(row.amount),
        value: row.value ?? null,
        status: row.status ?? null,
        coin: row.cointype ?? null,
        sessionId: row.sessionid ?? null,
      })),
    };
  }

  /** A date range as a Sequelize `where` fragment, `to` inclusive of its day. */
  #dateWhere(column, from, to) {
    if (!from && !to) return {};
    const range = {};
    if (from) range[Op.gte] = new Date(`${from}T00:00:00.000Z`);
    if (to) range[Op.lt] = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
    return { [column]: range };
  }

  /** The platform root. Configurable, because hard-coding `1` is what legacy did. */
  #isRoot(staffIds) {
    const root = Number(this.config.ROOT_STAFF_ID ?? 1);
    return staffIds.map(Number).includes(root);
  }

  /** Player names, in one query rather than a join across a service boundary. */
  async #namesFor(userIds) {
    const unique = [...new Set(userIds.map(Number).filter(Number.isInteger))];
    if (!unique.length) return new Map();

    const rows = await this.models.Users.findAll({
      where: { id: { [Op.in]: unique } },
      attributes: ['id', 'name'],
      raw: true,
    });

    return new Map(rows.map((r) => [Number(r.id), r.name]));
  }

  #emptyStats() {
    return { totals: this.#emptyTotals(), bySource: {}, byType: [], byCurrency: [], usdt: { totals: { bets: 0, wagered: '0', payouts: '0', ggr: '0' }, days: [], unconverted: [] } };
  }
}

module.exports = { BetHistoryService };
