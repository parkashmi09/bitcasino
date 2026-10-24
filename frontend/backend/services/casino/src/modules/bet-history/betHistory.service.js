'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { money } = require('@ibitplay/common');

const {
  SOURCES,
  SOURCE_KEYS,
  CATALOGS,
  classify,
  kindOf,
  countExpressions,
  statExpressions,
  finishedOf,
  MAX_ROWS_PER_SOURCE,
} = require('./betHistory.constants');

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
  async list({ page, limit, search, userId, from, to, source, staffId }) {
    const visible = await this.#visibleUserIds({ staffId, userId });
    if (visible.empty) return { rows: [], total: 0 };

    const wanted = source ? [source] : SOURCE_KEYS;
    const collected = [];

    for (const key of wanted) {
      collected.push(...(await this.#read(key, { visible, from, to, search })));
    }

    // Merged in memory because the four tables have no common key and no
    // shared ordering column the database could sort across. Each source is
    // capped, so the working set is bounded regardless of the date range.
    collected.sort((a, b) => new Date(b.transaction_timestamp) - new Date(a.transaction_timestamp));

    const offset = (page - 1) * limit;
    const pageRows = collected.slice(offset, offset + limit);

    // Both lookups are for the page only — the rows either side of it are never
    // rendered, so resolving names and titles for them is work nobody reads.
    const names = await this.#namesFor(pageRows.map((r) => r.user_id));
    const games = await this.#gameLabels(pageRows);

    return {
      rows: pageRows.map(({ gameCatalog, gameId, providerLabel, ...row }) => {
        const game = games.get(`${gameCatalog}:${gameId}`);
        return {
          ...row,
          user_name: names.get(row.user_id) ?? null,
          // The provider's id stays available under `game_uid`, because it is
          // what a support ticket names; `game_title` is what a column prints.
          game_uid: gameId,
          game_title: game?.name ?? gameId,
          // A game the catalog has no row for still came from somewhere, and
          // naming the aggregator beats an empty cell under the title.
          game_vendor: game?.vendor ?? providerLabel,
        };
      }),
      total: collected.length,
      truncated: collected.length >= MAX_ROWS_PER_SOURCE * wanted.length,
    };
  }

  /** @legacy GET /betHistory/transactions/user/:userId */
  async listForUser({ userId, staffId, ...rest }) {
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
  async #read(key, { visible, from, to, search }) {
    const source = SOURCES[key];
    const model = this.models[source.model];

    // A service that does not load a domain simply contributes nothing, rather
    // than throwing. That keeps the report usable in a partial deployment.
    if (!model) return [];

    const where = {};
    if (!visible.all) where[source.userColumn] = { [Op.in]: visible.ids };

    if (from || to) {
      where[source.timeColumn] = {
        ...(from ? { [Op.gte]: from } : {}),
        ...(to ? { [Op.lte]: to } : {}),
      };
    }

    // Search matches the transaction reference. Player-name search is applied
    // after the join below, because the name lives in another service's table.
    if (search) where[source.idColumn] = { [Op.iLike]: `%${search}%` };

    const rows = await model.findAll({
      where,
      order: [[source.timeColumn, 'DESC']],
      limit: MAX_ROWS_PER_SOURCE,
      raw: true,
    });

    return rows.map((row) => {
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
        gameCatalog: source.catalog,
        providerLabel: source.label,
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
      const model = catalog && this.models[catalog.model];
      // A catalog this deployment does not load leaves the raw id in place,
      // which is worse than a name and better than an empty column.
      if (!model) continue;

      const found = await model.findAll({
        where: { [catalog.keyColumn]: { [Op.in]: [...ids] } },
        attributes: [catalog.keyColumn, catalog.nameColumn, catalog.vendorColumn],
        raw: true,
      });

      for (const game of found) {
        labels.set(`${key}:${game[catalog.keyColumn]}`, {
          name: game[catalog.nameColumn] ?? null,
          vendor: game[catalog.vendorColumn] ?? null,
        });
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
  async stats({ userId, staffId, from, to }) {
    const visible = await this.#visibleUserIds({ staffId, userId });
    if (visible.empty) return this.#emptyStats();

    const totals = this.#emptyTotals();
    const bySource = {};

    for (const key of SOURCE_KEYS) {
      const source = SOURCES[key];
      const model = this.models[source.model];
      if (!model) continue;

      const where = {};
      if (!visible.all) where[source.userColumn] = { [Op.in]: visible.ids };
      if (from || to) {
        where[source.timeColumn] = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };
      }

      // Built from the frozen SOURCES table, never from a request — which is
      // what makes these safe to hand to `literal()`.
      const stat = statExpressions(source);

      const [row] = await model.findAll({
        where,
        attributes: Object.entries(stat).map(([name, sql]) => [literal(sql), name]),
        raw: true,
      });

      const entry = {
        total: Number(row?.movements ?? 0),
        bets: Number(row?.bets ?? 0),
        /** Legacy's `total_wins`: every win row, zero-value ones included. */
        wins: Number(row?.winRows ?? 0),
        paidWins: Number(row?.paidWins ?? 0),
        pushes: Number(row?.pushes ?? 0),
        losses: Number(row?.losses ?? 0),
        refunds: Number(row?.refunds ?? 0),
        wagered: String(row?.wagered ?? '0'),
        payouts: String(row?.payouts ?? '0'),
        refunded: String(row?.refunded ?? '0'),
        /** The PLAYERS' side: positive means the players are up on this source. */
        net: String(Number(row?.payouts ?? 0) - Number(row?.wagered ?? 0)),
      };

      bySource[source.label] = entry;
      for (const field of ['total', 'bets', 'wins', 'paidWins', 'pushes', 'losses', 'refunds']) {
        totals[field] += entry[field];
      }
      for (const field of ['wagered', 'payouts', 'refunded', 'net']) {
        totals[field] = String(Number(totals[field]) + Number(entry[field]));
      }
    }

    return { totals, bySource, byType: this.#byType(totals) };
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
  async analytics({ staffId }) {
    const visible = await this.#visibleUserIds({ staffId });
    if (visible.empty) {
      return { ...this.#emptyStats(), today: null, topUsers: [] };
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [allTime, today, topUsers] = await Promise.all([
      this.stats({ staffId }),
      this.stats({ staffId, from: startOfDay }),
      this.#topUsers(visible),
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
  async #topUsers(visible, limit = 10) {
    const perUser = new Map();
    const contributing = [];

    for (const key of SOURCE_KEYS) {
      const source = SOURCES[key];
      const model = this.models[source.model];
      if (!model) continue;

      const stat = statExpressions(source);
      const where = visible.all ? {} : { [source.userColumn]: { [Op.in]: visible.ids } };

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

    const ranked = [...perUser.entries()]
      .sort((a, b) => b[1].bets - a[1].bets || b[1].wagered - a[1].wagered)
      .slice(0, limit);

    const names = await this.#namesFor(ranked.map(([id]) => id));

    const scope = contributing.length ? contributing.join(', ') : 'no sources';

    return ranked.map(([id, entry]) => ({
      userId: id,
      userName: names.get(id) ?? null,
      bets: entry.bets,
      wagered: String(entry.wagered),
      won: String(entry.won),
      scope,
    }));
  }

  /**
   * @legacy GET /live-bets
   *
   * The public ticker. Player ids are NOT exposed — legacy answered with
   * `SELECT *` from `bets`, which put every player's id and full row on a page
   * anyone could load.
   */
  async liveFeed({ limit }) {
    const rows = await this.models.Bets.findAll({
      attributes: ['gid', 'amount', 'profit', 'coin', 'created', 'game'],
      order: [['created', 'DESC']],
      limit,
      raw: true,
    });

    return rows.map((row) => ({
      reference: String(row.gid),
      game: row.game ?? null,
      amount: String(row.amount ?? '0'),
      profit: String(row.profit ?? '0'),
      outcome: classify(row.profit),
      currency: row.coin ?? null,
      at: row.created,
    }));
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
     * `uid` is VARCHAR on all three timed-round tables, and `userId` arrives
     * from the token as a number. Postgres does not coerce across that:
     *
     *     operator does not exist: character varying = bigint
     *
     * which surfaced as a 500 on every call to this route. The rest of the
     * platform already knows — `auth.service` writes `String(user.id)` for the
     * same column family — this one call site did not.
     */
    /**
     * NO ORDER BY, because there is nothing to order on.
     *
     * `bets_30s`, `bets_1m` and `bets_2m` are six varchar columns with no
     * primary key and no timestamp. The models say so and call
     * `removeAttribute('id')` to stop Sequelize inventing one — this call
     * asked for `ORDER BY id DESC` regardless, and Postgres answered
     * `column Bets2m.id does not exist`: a second 500 sitting behind the
     * varchar/bigint one, on all three intervals.
     *
     * So "the most recent rounds" is not expressible against these tables.
     * `limit` takes an ARBITRARY slice rather than the newest one, which is
     * worth knowing at the call site. Giving them an identity column is a
     * migration, not a fix here.
     */
    return model.findAll({
      where: { uid: String(userId) },
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
  async #visibleUserIds({ staffId, userId }) {
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
    if (this.#isRoot(staffIds)) return { all: true, ids: [] };

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
  async luckySports({ staffId, userId, from, to, page = 1, limit = 20 }) {
    const visible = await this.#visibleUserIds({ staffId, userId });
    if (visible.empty) return { total: 0, rows: [] };

    const { rows, count } = await this.models.TransactionLive.findAndCountAll({
      where: {
        ...(visible.all ? {} : { user_id: { [Op.in]: visible.ids } }),
        ...this.#dateWhere('created_at', from, to),
      },
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    const names = await this.#namesFor(rows.map((r) => r.user_id));

    return {
      total: count,
      rows: rows.map((row) => ({
        id: String(row.id),
        at: row.created_at ?? null,
        userId: row.user_id != null ? String(row.user_id) : null,
        user: names.get(Number(row.user_id)) ?? null,
        /**
         * `transaction_live` stores money in a BIGINT column, so every amount
         * legacy wrote to it was already rounded to a whole unit — migration
         * 017 records settlements in NUMERIC columns and leaves these as the
         * historical record. Read as-is; the rounding happened at write time
         * and cannot be undone here.
         */
        amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
        type: row.type ?? row.transaction_type ?? null,
        status: row.status ?? null,
      })),
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
  async rawTransactions({ table, staffId, userId, from, to, page = 1, limit = 20 }) {
    const visible = await this.#visibleUserIds({ staffId, userId });
    if (visible.empty) return { total: 0, rows: [] };

    const model = table === 'slot' ? this.models.TransactionSlot : this.models.TransactionLive;

    const { rows, count } = await model.findAndCountAll({
      where: {
        ...(visible.all ? {} : { user_id: { [Op.in]: visible.ids } }),
        ...this.#dateWhere('created_at', from, to),
      },
      order: [['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((row) => ({
        id: String(row.id),
        at: row.created_at ?? null,
        userId: row.user_id != null ? String(row.user_id) : null,
        amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
        status: row.status ?? null,
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
  async houseBets({ table = 'bets', staffId, userId, from, to, page = 1, limit = 20 }) {
    const visible = await this.#visibleUserIds({ staffId, userId });
    if (visible.empty) return { total: 0, rows: [] };

    const model = table === 'bets_2m' ? this.models.Bets2m : this.models.Bets;

    const { rows, count } = await model.findAndCountAll({
      where: {
        ...(visible.all ? {} : { uid: { [Op.in]: visible.ids } }),
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
    return { totals: this.#emptyTotals(), bySource: {}, byType: [] };
  }
}

module.exports = { BetHistoryService };
