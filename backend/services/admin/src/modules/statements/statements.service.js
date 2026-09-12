'use strict';

const { Op, fn, col, where: whereFn } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./statements.errors');
const { buildLedger, dailyFromEvents, finishDaily, finaliseGaming, dayOf } = require('./ledger');
const {
  KIND,
  SPORTS_LEDGER_REASONS,
  OPEN_BET_STATUSES,
  CASINO_INR_CURRENCIES,
  HEADLINE_FOR,
} = require('./statements.constants');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * When a casino round HAPPENED.
 *
 * `gis_transactions` carries both a provider timestamp and a row-insert one,
 * and the ledger reports the round under `COALESCE(transaction_datetime,
 * created_at)`. Every filter, grouping and ordering over the table has to use
 * that same expression or a round lands on one day in the ledger and a
 * different day in the totals beside it — which is exactly what a statement
 * exists to rule out. Legacy got this right; the port filtered on `created_at`.
 */
const CASINO_TS = fn('COALESCE', col('transaction_datetime'), col('created_at'));

/**
 * Account statements for an agent or a player.
 *
 * Both produce the SAME payload shape, so one screen and one PDF renderer
 * handle either. That was legacy's design and it is worth keeping.
 */
class StatementsService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Agent
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/agent-report/:staffId/statement
   *
   * An agent's own wallet, plus what their downline's play earned them.
   *
   * Casino and sports never touch an agent's wallet, so play is reported as
   * profit and loss rather than as movement — the ledger rows are transfers
   * only. That distinction is legacy's and it is right.
   */
  async agentStatement({ staff, staffId, from, to, page = 1, limit = 100, category = 'all' }) {
    const agent = await this.#assertStaffVisible(staff, staffId);

    const tree = await descendantIds(this.models, agent.id, { logger: this.logger });
    const treeSet = new Set(tree.map(String));

    const [staffRows, players] = await Promise.all([
      this.models.Staff.findAll({
        where: { id: tree },
        attributes: ['id', 'name', 'parent_id', 'role_id'],
        order: [['id', 'ASC']],
        raw: true,
      }),
      this.models.Users.findAll({
        where: { parent_staff_id: tree },
        attributes: ['id', 'name', 'parent_staff_id'],
        order: [['parent_staff_id', 'ASC'], ['name', 'ASC']],
        raw: true,
      }),
    ]);

    const playerIds = players.map((p) => p.id);

    /**
     * Everything the downline tables need beside the P&L.
     *
     * Legacy reported each player's WALLET and the money the tree moved in and
     * out of it, and each sub-agent's role, depth and own balance — a settlement
     * conversation is "you hold this much, I gave you this much, you collected
     * this much", and a P&L column on its own does not have that conversation.
     * None of it was carried in this port; the screen rendered blanks.
     */
    const [transfers, roleNames, staffBalances, playerWallets, playerMoved] = await Promise.all([
      // Every transfer touching THIS agent's own wallet.
      this.models.StaffTransfers.findAll({
        where: {
          [Op.or]: [
            { from_type: 'staff', from_id: agent.id },
            { to_type: 'staff', to_id: agent.id },
          ],
        },
        order: [['created_at', 'ASC'], ['id', 'ASC']],
        raw: true,
      }),
      this.#roleNames(staffRows.map((s) => s.role_id)),
      this.#staffBalances(tree),
      this.#playerWallets(playerIds),
      this.#playerTransferTotals(playerIds, { from, to }),
    ]);

    const names = await this.#nameLookup(transfers);

    const events = transfers.map((row) => {
      const incoming = row.to_type === 'staff' && String(row.to_id) === String(agent.id);
      const classified = this.#classifyStaffRow(row, agent.id, treeSet, names);
      return {
        id: String(row.id),
        ts: row.created_at,
        kind: classified.kind,
        label: classified.label,
        party: classified.party,
        note: row.note ?? null,
        // Legacy carried non-'transfer' rows through with a `legacy` marker so
        // a historical GT settlement was visible as such rather than silently
        // counted as an ordinary transfer.
        legacy: row.transfer_type !== 'transfer' ? row.transfer_type : null,
        amount: incoming ? String(row.amount) : `-${row.amount}`,
      };
    });

    const balances = await this.models.StaffBalances.findOne({
      where: { staff_id: agent.id },
      raw: true,
    });
    const live = money.fromStored(balances?.inr ?? '0');

    const ledger = buildLedger(events, live, { from, to, page, limit, category });

    const buckets = this.#bucketByKind(ledger.inside);

    const gaming = await this.#gatherGaming(playerIds, { from, to });
    const finalised = finaliseGaming({
      sportsPlayerPnl: gaming.sports.playerPnl,
      casinoPlayerPnl: gaming.casino.playerPnl,
      headlineFor: HEADLINE_FOR.AGENT,
    });

    const { days, day } = dailyFromEvents(ledger.inside);
    for (const d of gaming.sportsDaily) day(d.date).sportsPnl -= money.toMinor(d.playerPnl);
    for (const d of gaming.casinoDaily) day(d.date).casinoPnl -= money.toMinor(d.playerPnl);

    return {
      subject: {
        type: 'STAFF',
        id: String(agent.id),
        name: agent.name,
        email: agent.email ?? null,
        role: agent.role ?? null,
        level: agent.level ?? null,
        agentCode: agent.agent_code ?? null,
        parentName: agent.parent_name ?? null,
      },
      period: { from: from ?? null, to: to ?? null },
      category,
      balance: {
        live,
        opening: ledger.opening,
        closing: ledger.closing,
        movement: ledger.movement,
        unexplained: ledger.unexplained,
        depositIn: buckets[KIND.DEPOSIT_UPLINE],
        withdrawOut: buckets[KIND.WITHDRAW_UPLINE],
        givenAgents: buckets[KIND.DEPOSIT_AGENT],
        givenPlayers: buckets[KIND.DEPOSIT_PLAYER],
        collectedAgents: buckets[KIND.COLLECTED_AGENT],
        collectedPlayers: buckets[KIND.COLLECTED_PLAYER],
        /** What went out to, and came back from, the downline as a whole. */
        givenDownline: this.#sum(buckets[KIND.DEPOSIT_AGENT], buckets[KIND.DEPOSIT_PLAYER]),
        collectedDownline: this.#sum(buckets[KIND.COLLECTED_AGENT], buckets[KIND.COLLECTED_PLAYER]),
        bankIn: '0.00000000',
        bankOut: '0.00000000',
        totalIn: this.#sum(buckets[KIND.DEPOSIT_UPLINE], buckets[KIND.COLLECTED_AGENT], buckets[KIND.COLLECTED_PLAYER]),
        totalOut: this.#sum(buckets[KIND.WITHDRAW_UPLINE], buckets[KIND.DEPOSIT_AGENT], buckets[KIND.DEPOSIT_PLAYER]),
        openExposure: gaming.sports.openStake,
      },
      rows: ledger.rows,
      pagination: ledger.pagination,
      gaming: this.#gamingPayload(gaming, finalised),
      daily: finishDaily(days),
      sportsDaily: gaming.sportsDaily,
      casinoDaily: gaming.casinoDaily,
      players: this.#perPlayerRows(players, staffRows, gaming, { playerWallets, playerMoved }),
      downline: this.#perStaffRows(agent.id, staffRows, players, gaming, {
        roleNames,
        staffBalances,
        playerWallets,
        playerMoved,
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Player
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/agent-report/user/:userId/statement
   *
   * A player's wallet, from every source that moves it.
   *
   * Unlike the agent's, this ledger DOES carry play — a bet leaves the wallet
   * and a win returns to it — so the running balance reconciles against
   * `credits.inr`.
   */
  async userStatement({ staff, userId, from, to, page = 1, limit = 100, category = 'all' }) {
    const user = await this.#assertUserVisible(staff, userId);

    const events = await this.#collectUserEvents(user.id);

    const credits = await this.models.Credits.findOne({ where: { uid: user.id }, raw: true });
    const live = money.fromStored(credits?.inr ?? '0');

    const ledger = buildLedger(events, live, { from, to, page, limit, category });

    let depositIn = 0n;
    let withdrawOut = 0n;
    let bankIn = 0n;
    let bankOut = 0n;

    for (const event of ledger.inside) {
      const minor = money.toMinor(event.amount);
      if (event.kind === KIND.DEPOSIT_UPLINE) depositIn += minor;
      else if (event.kind === KIND.WITHDRAW_UPLINE) withdrawOut += -minor;
      else if (event.kind === KIND.BANK_DEPOSIT || event.kind === KIND.GATEWAY_DEPOSIT) bankIn += minor;
      else if (event.kind === KIND.BANK_WITHDRAW || event.kind === KIND.GATEWAY_WITHDRAW) bankOut += -minor;
    }

    const gaming = await this.#gatherGaming([user.id], { from, to });
    const finalised = finaliseGaming({
      sportsPlayerPnl: gaming.sports.playerPnl,
      casinoPlayerPnl: gaming.casino.playerPnl,
      headlineFor: HEADLINE_FOR.PLAYER,
    });

    const { days, day } = dailyFromEvents(ledger.inside);
    for (const d of gaming.sportsDaily) day(d.date).sportsPnl += money.toMinor(d.playerPnl);
    for (const d of gaming.casinoDaily) day(d.date).casinoPnl += money.toMinor(d.playerPnl);

    /**
     * A player's ledger includes their bets, and an unsettled stake has left
     * the wallet with no settlement row yet — so wallet + open exposure is what
     * the ledger adds up to, and `unexplained` has to account for it.
     *
     * LIFETIME, not the period's. `ledger.lifetimeNet` covers every event the
     * player ever produced, so the exposure it is reconciled against has to
     * cover every open bet — a bet placed before `from` is still holding stake
     * out of the wallet today. Netting a lifetime figure against a
     * period-filtered one reported a bogus discrepancy on every range that was
     * not all-time.
     */
    const openExposure = await this.#openExposure([user.id]);
    const unexplained = money.toDecimalString(
      money.toMinor(live) + money.toMinor(openExposure) - money.toMinor(ledger.lifetimeNet)
    );

    return {
      subject: {
        type: 'USER',
        id: String(user.id),
        name: user.name,
        email: user.email ?? null,
        role: 'User',
        level: null,
        agentCode: null,
        parentName: user.staff_name ?? null,
      },
      period: { from: from ?? null, to: to ?? null },
      category,
      balance: {
        live,
        opening: ledger.opening,
        closing: ledger.closing,
        movement: ledger.movement,
        unexplained,
        depositIn: money.toDecimalString(depositIn),
        withdrawOut: money.toDecimalString(withdrawOut),
        bankIn: money.toDecimalString(bankIn),
        bankOut: money.toDecimalString(bankOut),
        givenAgents: '0.00000000',
        givenPlayers: '0.00000000',
        givenDownline: '0.00000000',
        collectedAgents: '0.00000000',
        collectedPlayers: '0.00000000',
        collectedDownline: '0.00000000',
        totalIn: money.toDecimalString(depositIn + bankIn),
        totalOut: money.toDecimalString(withdrawOut + bankOut),
        openExposure,
      },
      rows: ledger.rows,
      pagination: ledger.pagination,
      gaming: this.#gamingPayload(gaming, finalised),
      daily: finishDaily(days),
      sportsDaily: gaming.sportsDaily,
      casinoDaily: gaming.casinoDaily,
      /** The subject as their own single row, so one renderer handles either. */
      players: this.#perPlayerRows(
        [{ id: user.id, name: user.name, parent_staff_id: user.parent_staff_id }],
        [{ id: user.parent_staff_id, name: user.staff_name }],
        gaming,
        {
          playerWallets: new Map([[String(user.id), live]]),
          playerMoved: new Map([[String(user.id), {
            funded: depositIn + bankIn,
            collected: withdrawOut + bankOut,
          }]]),
        }
      ),
      downline: [],
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The bets behind the totals
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/admin/agent-report/:staffId/bets
   * @legacy GET /api/admin/agent-report/user/:userId/bets
   *
   * Split out of the statement because these lists are unbounded — a busy tree
   * runs to tens of thousands of rows — so they page on the server rather than
   * being capped and silently truncated. Legacy's reasoning, kept.
   */
  async bets({ staff, staffId, userId, kind = 'sports', from, to, page = 1, limit = 50 }) {
    const ids = await this.#resolvePlayerIds(staff, { staffId, userId });
    const offset = (page - 1) * limit;

    if (!ids.length) {
      return { kind, total: 0, rows: [], pagination: { page, limit, total: 0, totalPages: 1 } };
    }

    if (kind === 'casino') return this.#casinoBets(ids, { from, to, page, limit, offset });
    return this.#sportsBets(ids, { from, to, page, limit, offset });
  }

  async #sportsBets(ids, { from, to, page, limit, offset }) {
    const where = { user_id: ids, ...this.#dateWhere('created_at', from, to) };

    const { rows, count } = await this.models.SportsBet.findAndCountAll({
      where,
      attributes: [
        'id', 'created_at', 'user_id', 'match_title', 'event_name', 'selection_name',
        'fancy_name', 'market_type', 'bet_type', 'odds', 'stake_amount', 'status',
        'result_status', 'game_type',
      ],
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#userNames(rows.map((r) => r.user_id));

    return {
      kind: 'sports',
      total: count,
      rows: rows.map((bet) => ({
        id: String(bet.id),
        ts: bet.created_at,
        user: names.get(String(bet.user_id)) ?? String(bet.user_id),
        match: this.#text(bet.match_title, bet.event_name),
        selection: this.#text(bet.fancy_name, bet.selection_name),
        market: this.#text(bet.market_type, bet.game_type),
        side: this.#text(bet.bet_type),
        odds: bet.odds != null ? String(bet.odds) : null,
        // `toMinorQuantised` — a stored column, see the note in `ledger.js`.
        stake: money.fromStored(bet.stake_amount ?? '0', { field: 'stake' }),
        status: bet.status,
        result: bet.result_status ?? null,
      })),
      pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
    };
  }

  async #casinoBets(ids, { from, to, page, limit, offset }) {
    const where = {
      user_id: ids,
      currency: { [Op.in]: CASINO_INR_CURRENCIES },
      ...this.#casinoDateWhere(from, to),
    };

    const { rows, count } = await this.models.GisTransactions.findAndCountAll({
      where,
      attributes: ['id', 'transaction_datetime', 'created_at', 'user_id', 'action', 'amount', 'round_id', 'game_uuid'],
      // The timestamp the row is REPORTED under, so the list and the totals
      // above it agree about which day a round belongs to.
      order: [[CASINO_TS, 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const [names, games] = await Promise.all([
      this.#userNames(rows.map((r) => r.user_id)),
      this.#gameNames(rows.map((r) => r.game_uuid).filter(Boolean)),
    ]);

    return {
      kind: 'casino',
      total: count,
      rows: rows.map((tx) => {
        const minor = money.toMinorQuantised(tx.amount ?? '0');
        return {
          id: String(tx.id),
          ts: tx.transaction_datetime ?? tx.created_at,
          user: names.get(String(tx.user_id)) ?? String(tx.user_id),
          action: tx.action,
          game: games.get(tx.game_uuid) ?? this.#text(tx.game_uuid),
          round: tx.round_id ?? null,
          amount: money.toDecimalString(tx.action === 'bet' ? -minor : minor),
        };
      }),
      pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) },
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Gathering
  // ══════════════════════════════════════════════════════════════════════

  /** Every INR balance-affecting event for one player, oldest first. */
  async #collectUserEvents(userId) {
    const uid = String(userId);
    const events = [];
    const push = (ts, kind, label, party, amount, note, seq) =>
      events.push({ ts: ts ?? new Date(), kind, label, party, note: note ?? null, legacy: null, amount: String(amount), seq: seq ?? 0 });

    /**
     * 1. Agent transfers.
     *
     * `transfer_type='transfer'` only. Historical 'gt'/'casino' settlement rows
     * would double-count against the per-bet rows below — legacy's filter, and
     * the reason for it, both preserved.
     */
    const transfers = await this.models.StaffTransfers.findAll({
      where: {
        transfer_type: 'transfer',
        [Op.or]: [
          { to_type: 'user', to_id: userId },
          { from_type: 'user', from_id: userId },
        ],
      },
      order: [['created_at', 'ASC'], ['id', 'ASC']],
      raw: true,
    });

    const staffNames = await this.#staffNames(
      transfers.flatMap((t) => [t.from_type === 'staff' ? t.from_id : null, t.to_type === 'staff' ? t.to_id : null]).filter(Boolean)
    );

    for (const row of transfers) {
      const credit = row.to_type === 'user' && String(row.to_id) === uid;
      const counterparty = credit ? row.from_id : row.to_id;
      push(
        row.created_at,
        credit ? KIND.DEPOSIT_UPLINE : KIND.WITHDRAW_UPLINE,
        credit ? 'Deposit from agent' : 'Withdrawn by agent',
        staffNames.get(String(counterparty)) ?? '—',
        credit ? row.amount : `-${row.amount}`,
        row.note,
        Number(row.id) || 0
      );
    }

    // 2. Bank deposits.
    for (const row of await this.models.FiatDeposits.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: 'INR' },
        status: { [Op.in]: ['approved', 'success', 'done', 'completed', 'Approved', 'Success'] },
      },
      raw: true,
    })) {
      push(row.created_at, KIND.BANK_DEPOSIT, 'Bank deposit', 'Bank', row.amount, row.transaction_id, Number(row.id) || 0);
    }

    // 3. Gateway deposits.
    for (const row of await this.models.Apaydeposits.findAll({
      where: { user_id: uid, currency: { [Op.iLike]: 'INR' }, status: 'Success' },
      raw: true,
    })) {
      push(row.created_at, KIND.GATEWAY_DEPOSIT, 'Gateway deposit', 'Gateway', row.amount, row.order_id, Number(row.id) || 0);
    }

    /**
     * 4. Bank withdrawals.
     *
     * Anything not rejected or failed, INCLUDING pending: the money has left
     * the wallet the moment the request is accepted, so a statement that omits
     * pending withdrawals shows a balance the player does not have.
     */
    for (const row of await this.models.FiatWithdrawals.findAll({
      where: {
        uid,
        currency: { [Op.iLike]: 'INR' },
        status: { [Op.notIn]: ['rejected', 'failed', 'Rejected', 'Failed'] },
      },
      raw: true,
    })) {
      push(row.date, KIND.BANK_WITHDRAW, `Bank withdrawal (${row.status})`, 'Bank', `-${row.amount}`, null, Number(row.id) || 0);
    }

    // 5. Gateway withdrawals.
    for (const row of await this.models.Apaywithdrawals.findAll({
      where: {
        user_id: uid,
        currency: { [Op.iLike]: 'INR' },
        status: { [Op.in]: ['Success', 'Pending'] },
        [Op.or]: [{ refunded: false }, { refunded: null }],
      },
      raw: true,
    })) {
      push(row.created_at, KIND.GATEWAY_WITHDRAW, `Gateway withdrawal (${row.status})`, 'Gateway', `-${row.amount}`, row.order_id, Number(row.id) || 0);
    }

    /**
     * 6. Sports settlement.
     *
     * FILTERED BY REASON — see the module header. Legacy read every ledger row
     * and called it sports.
     */
    for (const row of await this.models.CreditsLedger.findAll({
      where: { user_id: uid, currency: { [Op.iLike]: 'INR' }, reason: { [Op.in]: SPORTS_LEDGER_REASONS } },
      raw: true,
    })) {
      const net = row.netamount != null ? row.netamount : row.amount;
      push(
        row.created_at,
        KIND.SPORTS,
        money.toMinorQuantised(net) >= 0n ? 'Sports bet won' : 'Sports bet lost',
        row.market_type || 'Sports',
        net,
        row.description || row.reason,
        Number(row.id) || 0
      );
    }

    // 7. Casino. The provider labels this platform's INR wallet 'PKR'.
    const casino = await this.models.GisTransactions.findAll({
      where: { user_id: userId, currency: { [Op.in]: CASINO_INR_CURRENCIES } },
      order: [['id', 'ASC']],
      raw: true,
    });
    const gameNames = await this.#gameNames(casino.map((r) => r.game_uuid).filter(Boolean));

    for (const row of casino) {
      const minor = money.toMinorQuantised(row.amount ?? '0');
      if (minor === 0n) continue; // zero-value win/refund rows move nothing
      const isBet = row.action === 'bet';
      push(
        row.transaction_datetime ?? row.created_at,
        KIND.CASINO,
        `Casino ${row.action}`,
        gameNames.get(row.game_uuid) ?? '—',
        money.toDecimalString(isBet ? -minor : minor),
        row.round_id ? `round ${row.round_id}` : null,
        Number(row.id) || 0
      );
    }

    events.sort((a, b) => {
      const byTime = new Date(a.ts).getTime() - new Date(b.ts).getTime();
      return byTime || a.seq - b.seq;
    });
    events.forEach((event, index) => {
      event.id = String(index + 1);
    });

    return events;
  }

  /**
   * Sports and casino totals, per day and in aggregate, for a set of players.
   *
   * Aggregated in the database rather than by reading every bet into memory.
   */
  async #gatherGaming(playerIds, { from, to }) {
    const empty = {
      sports: { playerPnl: '0.00000000', turnover: '0.00000000', openStake: '0.00000000' },
      casino: { playerPnl: '0.00000000', staked: '0.00000000', won: '0.00000000' },
      counts: { settledBets: 0, placedBets: 0, openBets: 0, casinoTxns: 0, casinoBets: 0, casinoWins: 0 },
      sportsDaily: [],
      casinoDaily: [],
      perPlayer: new Map(),
    };
    if (!playerIds.length) return empty;

    const ids = playerIds.map(Number);
    const asText = playerIds.map(String);

    const ledgerWhere = {
      user_id: asText,
      currency: { [Op.iLike]: 'INR' },
      reason: { [Op.in]: SPORTS_LEDGER_REASONS },
      ...this.#dateWhere('created_at', from, to),
    };

    const [sportsPerPlayer, sportsDaily, betAgg, casinoAgg, casinoPerPlayer, casinoDaily] = await Promise.all([
      this.models.CreditsLedger.findAll({
        where: ledgerWhere,
        attributes: ['user_id', [fn('COUNT', col('id')), 'bets'], [fn('COALESCE', fn('SUM', col('netamount')), 0), 'net']],
        group: ['user_id'],
        raw: true,
      }),
      this.models.CreditsLedger.findAll({
        where: ledgerWhere,
        attributes: [
          [fn('DATE', col('created_at')), 'date'],
          [fn('COUNT', col('id')), 'bets'],
          [fn('COALESCE', fn('SUM', col('netamount')), 0), 'net'],
        ],
        group: [fn('DATE', col('created_at'))],
        order: [[fn('DATE', col('created_at')), 'ASC']],
        raw: true,
      }),
      this.models.SportsBet.findAll({
        where: { user_id: ids, ...this.#dateWhere('created_at', from, to) },
        attributes: ['status', [fn('COUNT', col('id')), 'n'], [fn('COALESCE', fn('SUM', col('stake_amount')), 0), 'stake']],
        group: ['status'],
        raw: true,
      }),
      this.models.GisTransactions.findAll({
        where: { user_id: ids, currency: { [Op.in]: CASINO_INR_CURRENCIES }, ...this.#casinoDateWhere(from, to) },
        attributes: ['action', [fn('COUNT', col('id')), 'n'], [fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
        group: ['action'],
        raw: true,
      }),
      this.models.GisTransactions.findAll({
        where: { user_id: ids, currency: { [Op.in]: CASINO_INR_CURRENCIES }, ...this.#casinoDateWhere(from, to) },
        attributes: ['user_id', 'action', [fn('COUNT', col('id')), 'n'], [fn('COALESCE', fn('SUM', col('amount')), 0), 'total']],
        group: ['user_id', 'action'],
        raw: true,
      }),
      this.models.GisTransactions.findAll({
        where: { user_id: ids, currency: { [Op.in]: CASINO_INR_CURRENCIES }, ...this.#casinoDateWhere(from, to) },
        attributes: [
          [fn('DATE', CASINO_TS), 'date'],
          'action',
          [fn('COUNT', col('id')), 'n'],
          [fn('COALESCE', fn('SUM', col('amount')), 0), 'total'],
        ],
        group: [fn('DATE', CASINO_TS), 'action'],
        order: [[fn('DATE', CASINO_TS), 'ASC']],
        raw: true,
      }),
    ]);

    const perPlayer = new Map(asText.map((id) => [id, { sportsPnl: 0n, casinoPnl: 0n, sportsBets: 0, casinoBets: 0, casinoStaked: 0n }]));

    // Every figure below is a `SUM()` over a bare `numeric` column, so it
    // carries whatever precision the stored rows do — `toMinorQuantised`, not
    // `toMinor`. See the note in `ledger.js`.
    let sportsPnl = 0n;
    let settledBets = 0;
    for (const row of sportsPerPlayer) {
      const net = money.toMinorQuantised(row.net ?? '0');
      sportsPnl += net;
      settledBets += Number(row.bets) || 0;
      const entry = perPlayer.get(String(row.user_id));
      if (entry) {
        entry.sportsPnl = net;
        entry.sportsBets = Number(row.bets) || 0;
      }
    }

    let turnover = 0n;
    let openStake = 0n;
    let placedBets = 0;
    let openBets = 0;
    for (const row of betAgg) {
      const stake = money.toMinorQuantised(row.stake ?? '0');
      const n = Number(row.n) || 0;
      turnover += stake;
      placedBets += n;
      if (OPEN_BET_STATUSES.includes(row.status)) {
        openStake += stake;
        openBets += n;
      }
    }

    let casinoStaked = 0n;
    let casinoWon = 0n;
    let casinoTxns = 0;
    let casinoBets = 0;
    let casinoWins = 0;
    for (const row of casinoAgg) {
      const total = money.toMinorQuantised(row.total ?? '0');
      const n = Number(row.n) || 0;
      casinoTxns += n;
      if (row.action === 'bet') {
        casinoStaked += total;
        casinoBets += n;
      } else {
        casinoWon += total;
        casinoWins += n;
      }
    }

    for (const row of casinoPerPlayer) {
      const entry = perPlayer.get(String(row.user_id));
      if (!entry) continue;
      const total = money.toMinorQuantised(row.total ?? '0');
      if (row.action === 'bet') {
        entry.casinoPnl -= total;
        entry.casinoStaked += total;
        entry.casinoBets += Number(row.n) || 0;
      } else {
        entry.casinoPnl += total;
      }
    }

    const casinoByDay = new Map();
    for (const row of casinoDaily) {
      const date = dayOf(row.date);
      if (!casinoByDay.has(date)) casinoByDay.set(date, { date, bets: 0, staked: 0n, won: 0n });
      const bucket = casinoByDay.get(date);
      const total = money.toMinorQuantised(row.total ?? '0');
      if (row.action === 'bet') {
        bucket.staked += total;
        bucket.bets += Number(row.n) || 0;
      } else {
        bucket.won += total;
      }
    }

    return {
      sports: {
        playerPnl: money.toDecimalString(sportsPnl),
        turnover: money.toDecimalString(turnover),
        openStake: money.toDecimalString(openStake),
      },
      casino: {
        playerPnl: money.toDecimalString(casinoWon - casinoStaked),
        staked: money.toDecimalString(casinoStaked),
        won: money.toDecimalString(casinoWon),
      },
      counts: { settledBets, placedBets, openBets, casinoTxns, casinoBets, casinoWins },
      sportsDaily: sportsDaily.map((row) => ({
        date: dayOf(row.date),
        bets: Number(row.bets) || 0,
        playerPnl: money.toDecimalString(money.toMinorQuantised(row.net ?? '0')),
        agentPnl: money.toDecimalString(-money.toMinorQuantised(row.net ?? '0')),
      })),
      casinoDaily: [...casinoByDay.values()].map((d) => ({
        date: d.date,
        bets: d.bets,
        staked: money.toDecimalString(d.staked),
        won: money.toDecimalString(d.won),
        playerPnl: money.toDecimalString(d.won - d.staked),
        agentPnl: money.toDecimalString(d.staked - d.won),
      })),
      perPlayer,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Scoping
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The agent must be the caller, or below them.
   *
   * `descendantIds` walks `staff.parent_id` and includes the root itself, so
   * "yourself" needs no special case — legacy special-cased it because it
   * queried `staff_hierarchy`, whose depth-0 self rows are written only when a
   * staff member is created through the API. Any row seeded directly has no
   * self row, and for those, legacy's own statement route would have refused
   * the agent their own statement.
   */
  async #assertStaffVisible(staff, staffId) {
    const id = Number(staffId);
    if (!Number.isInteger(id) || id <= 0) throw errors.SUBJECT_NOT_FOUND({ staffId });

    const tree = await descendantIds(this.models, staff.id, { logger: this.logger });
    if (!tree.map(Number).includes(id)) throw errors.SUBJECT_NOT_FOUND({ staffId });

    const agent = await this.models.Staff.findOne({
      where: { id },
      attributes: ['id', 'name', 'email', 'agent_code', 'role_id', 'parent_id'],
      raw: true,
    });
    if (!agent) throw errors.SUBJECT_NOT_FOUND({ staffId });

    const [role, parent] = await Promise.all([
      agent.role_id
        ? this.models.Roles.findOne({ where: { id: agent.role_id }, attributes: ['name', 'level'], raw: true })
        : null,
      agent.parent_id
        ? this.models.Staff.findOne({ where: { id: agent.parent_id }, attributes: ['name'], raw: true })
        : null,
    ]);

    return { ...agent, role: role?.name ?? null, level: role?.level ?? null, parent_name: parent?.name ?? null };
  }

  /**
   * The player must sit under the caller.
   *
   * Legacy checked `staff_hierarchy WHERE ancestor_id=caller AND
   * descendant_id=user.parent_staff_id`, which for a DIRECT signup — whose
   * `parent_staff_id` is NULL — matches nothing, so no direct player's
   * statement could be pulled by anyone at all.
   */
  async #assertUserVisible(staff, userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) throw errors.SUBJECT_NOT_FOUND({ userId });

    const tree = await descendantIds(this.models, staff.id, { logger: this.logger });
    const seesUnassigned = tree.map(Number).includes(1);

    const user = await this.models.Users.findOne({
      where: {
        id,
        ...(seesUnassigned
          ? { [Op.or]: [{ parent_staff_id: tree }, { parent_staff_id: null }] }
          : { parent_staff_id: tree }),
      },
      attributes: ['id', 'name', 'email', 'parent_staff_id'],
      raw: true,
    });
    if (!user) throw errors.SUBJECT_NOT_FOUND({ userId });

    const agent = user.parent_staff_id
      ? await this.models.Staff.findOne({ where: { id: user.parent_staff_id }, attributes: ['name'], raw: true })
      : null;

    return { ...user, staff_name: agent?.name ?? null };
  }

  /** Which players a bet list covers, enforcing the hierarchy either way. */
  async #resolvePlayerIds(staff, { staffId, userId }) {
    if (userId != null) {
      const user = await this.#assertUserVisible(staff, userId);
      return [Number(user.id)];
    }

    const agent = await this.#assertStaffVisible(staff, staffId);
    const tree = await descendantIds(this.models, agent.id, { logger: this.logger });

    const players = await this.models.Users.findAll({
      where: { parent_staff_id: tree },
      attributes: ['id'],
      raw: true,
    });
    return players.map((p) => Number(p.id));
  }

  // ══════════════════════════════════════════════════════════════════════

  /** Label one transfer row from the agent's point of view. */
  #classifyStaffRow(row, staffId, treeSet, names) {
    const incoming = row.to_type === 'staff' && String(row.to_id) === String(staffId);

    if (incoming) {
      const party = names.get(`${row.from_type}:${row.from_id}`) ?? String(row.from_id);
      if (row.from_type === 'user') return { kind: KIND.COLLECTED_PLAYER, label: 'Withdraw from player', party };
      if (treeSet.has(String(row.from_id))) return { kind: KIND.COLLECTED_AGENT, label: 'Withdraw from downline', party };
      return { kind: KIND.DEPOSIT_UPLINE, label: 'Deposit received from upline', party };
    }

    const party = names.get(`${row.to_type}:${row.to_id}`) ?? String(row.to_id);
    if (row.to_type === 'user') return { kind: KIND.DEPOSIT_PLAYER, label: 'Deposit to player', party };
    if (treeSet.has(String(row.to_id))) return { kind: KIND.DEPOSIT_AGENT, label: 'Deposit to downline', party };
    return { kind: KIND.WITHDRAW_UPLINE, label: 'Withdrawn by upline', party };
  }

  /**
   * The gaming block, whole.
   *
   * `finaliseGaming` decides the SIGNS; `#gatherGaming` counts the BETS and
   * sums the STAKES. Both halves belong in the payload — a screen that can say
   * "you are up ₹4,000" but not "over 312 settled bets and ₹80,000 staked" is
   * reporting an outcome with no way to judge it, and the port dropped every
   * count and every stake figure on the floor after computing them.
   */
  #gamingPayload(gaming, finalised) {
    const { counts } = gaming;
    return {
      sports: {
        settledBets: counts.settledBets,
        placedBets: counts.placedBets,
        openBets: counts.openBets,
        turnover: gaming.sports.turnover,
        openStake: gaming.sports.openStake,
        playerPnl: finalised.sports.playerPnl,
        agentPnl: finalised.sports.agentPnl,
      },
      casino: {
        txns: counts.casinoTxns,
        bets: counts.casinoBets,
        wins: counts.casinoWins,
        staked: gaming.casino.staked,
        won: gaming.casino.won,
        playerPnl: finalised.casino.playerPnl,
        agentPnl: finalised.casino.agentPnl,
      },
      total: finalised.total,
      counts,
    };
  }

  /** Stake sitting in unsettled bets. Lifetime — see `userStatement`. */
  async #openExposure(playerIds) {
    if (!playerIds.length) return '0.00000000';
    const [row] = await this.models.SportsBet.findAll({
      where: { user_id: playerIds.map(Number), status: { [Op.in]: OPEN_BET_STATUSES } },
      attributes: [[fn('COALESCE', fn('SUM', col('stake_amount')), 0), 'stake']],
      raw: true,
    });
    return money.toDecimalString(money.toMinorQuantised(row?.stake ?? '0'));
  }

  #bucketByKind(events) {
    const totals = Object.fromEntries(Object.values(KIND).map((kind) => [kind, 0n]));
    for (const event of events) {
      const minor = money.toMinor(event.amount);
      totals[event.kind] += minor < 0n ? -minor : minor;
    }
    return Object.fromEntries(Object.entries(totals).map(([kind, value]) => [kind, money.toDecimalString(value)]));
  }

  #sum(...values) {
    return money.toDecimalString(values.reduce((total, value) => total + money.toMinor(value ?? '0'), 0n));
  }

  #perPlayerRows(players, staffRows, gaming, { playerWallets, playerMoved }) {
    const staffById = new Map(staffRows.map((s) => [String(s.id), s.name]));
    return players.map((player) => {
      const key = String(player.id);
      const stats = gaming.perPlayer?.get(key);
      const sports = stats?.sportsPnl ?? 0n;
      const casino = stats?.casinoPnl ?? 0n;
      const moved = playerMoved.get(key) ?? { funded: 0n, collected: 0n };
      return {
        id: key,
        name: player.name,
        staffName: staffById.get(String(player.parent_staff_id)) ?? null,
        /** The player's wallet right now — never period-filtered. */
        wallet: playerWallets.get(key) ?? '0.00000000',
        funded: money.toDecimalString(moved.funded),
        collected: money.toDecimalString(moved.collected),
        sportsBets: stats?.sportsBets ?? 0,
        casinoBets: stats?.casinoBets ?? 0,
        casinoStaked: money.toDecimalString(stats?.casinoStaked ?? 0n),
        sportsPnl: money.toDecimalString(sports),
        casinoPnl: money.toDecimalString(casino),
        playerPnl: money.toDecimalString(sports + casino),
        agentPnl: money.toDecimalString(-(sports + casino)),
      };
    });
  }

  #perStaffRows(rootId, staffRows, players, gaming, { roleNames, staffBalances, playerWallets, playerMoved }) {
    const depths = this.#depths(rootId, staffRows);

    const byStaff = new Map(
      staffRows.map((s) => [String(s.id), {
        id: String(s.id),
        name: s.name,
        role: roleNames.get(String(s.role_id)) ?? null,
        /** Rows below the root, so the screen can indent the tree. */
        depth: depths.get(String(s.id)) ?? 0,
        balance: staffBalances.get(String(s.id)) ?? '0.00000000',
        parentId: s.parent_id != null ? String(s.parent_id) : null,
        players: 0,
        wallet: 0n,
        funded: 0n,
        collected: 0n,
        sportsPnl: 0n,
        casinoPnl: 0n,
      }])
    );

    for (const player of players) {
      const bucket = byStaff.get(String(player.parent_staff_id));
      if (!bucket) continue;
      const key = String(player.id);
      bucket.players += 1;
      bucket.wallet += money.toMinorQuantised(playerWallets.get(key) ?? '0');
      const moved = playerMoved.get(key) ?? { funded: 0n, collected: 0n };
      bucket.funded += moved.funded;
      bucket.collected += moved.collected;
      const stats = gaming.perPlayer?.get(key);
      // Agent-facing throughout this table: the agent keeps what players lose.
      bucket.sportsPnl -= stats?.sportsPnl ?? 0n;
      bucket.casinoPnl -= stats?.casinoPnl ?? 0n;
    }

    return [...byStaff.values()]
      .sort((a, b) => a.depth - b.depth || Number(a.id) - Number(b.id))
      .map((s) => ({
        ...s,
        wallet: money.toDecimalString(s.wallet),
        funded: money.toDecimalString(s.funded),
        collected: money.toDecimalString(s.collected),
        sportsPnl: money.toDecimalString(s.sportsPnl),
        casinoPnl: money.toDecimalString(s.casinoPnl),
        agentPnl: money.toDecimalString(s.sportsPnl + s.casinoPnl),
        playerPnl: money.toDecimalString(-(s.sportsPnl + s.casinoPnl)),
      }));
  }

  /**
   * How far each staff row sits below the root.
   *
   * Legacy read `staff_hierarchy.depth`; this port walks `parent_id`, which is
   * the same tree and does not depend on rows a direct seed never wrote.
   */
  #depths(rootId, staffRows) {
    const parents = new Map(staffRows.map((s) => [String(s.id), s.parent_id != null ? String(s.parent_id) : null]));
    const root = String(rootId);
    const depths = new Map([[root, 0]]);

    const depthOf = (id, guard = 0) => {
      if (depths.has(id)) return depths.get(id);
      const parent = parents.get(id);
      // No parent inside the subtree, or a cycle: treat as a direct child.
      if (!parent || guard > 20) return 1;
      const depth = depthOf(parent, guard + 1) + 1;
      depths.set(id, depth);
      return depth;
    };

    for (const s of staffRows) depthOf(String(s.id));
    return depths;
  }

  /**
   * A date range as a Sequelize `where` fragment.
   *
   * `to` is inclusive of the whole day — a caller asking for `to=2026-08-04`
   * means through the end of that day, not up to midnight at its start.
   */
  #dateWhere(column, from, to) {
    if (!from && !to) return {};
    const range = {};
    if (from) range[Op.gte] = new Date(`${from}T00:00:00.000Z`);
    if (to) range[Op.lt] = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
    return { [column]: range };
  }

  /**
   * The same window as `#dateWhere`, but over `COALESCE(transaction_datetime,
   * created_at)` — see `CASINO_TS`.
   */
  #casinoDateWhere(from, to) {
    if (!from && !to) return {};
    const conditions = [];
    if (from) conditions.push(whereFn(CASINO_TS, { [Op.gte]: new Date(`${from}T00:00:00.000Z`) }));
    if (to) {
      conditions.push(
        whereFn(CASINO_TS, { [Op.lt]: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) })
      );
    }
    return { [Op.and]: conditions };
  }

  async #roleNames(roleIds) {
    const unique = [...new Set(roleIds.map(Number).filter(Number.isInteger))];
    if (!unique.length) return new Map();
    const rows = await this.models.Roles.findAll({ where: { id: unique }, attributes: ['id', 'name'], raw: true });
    return new Map(rows.map((r) => [String(r.id), r.name]));
  }

  async #staffBalances(staffIds) {
    const unique = [...new Set(staffIds.map(Number).filter(Number.isInteger))];
    if (!unique.length) return new Map();
    const rows = await this.models.StaffBalances.findAll({
      where: { staff_id: unique },
      attributes: ['staff_id', 'inr'],
      raw: true,
    });
    return new Map(rows.map((r) => [String(r.staff_id), money.fromStored(r.inr ?? '0')]));
  }

  async #playerWallets(playerIds) {
    const unique = [...new Set(playerIds.map(Number).filter(Number.isInteger))];
    if (!unique.length) return new Map();
    const rows = await this.models.Credits.findAll({
      where: { uid: unique },
      attributes: ['uid', 'inr'],
      raw: true,
    });
    return new Map(rows.map((r) => [String(r.uid), money.fromStored(r.inr ?? '0')]));
  }

  /**
   * What the tree put into, and took out of, each player's wallet in the period.
   *
   * `transfer_type='transfer'` only, for the same reason the player ledger
   * filters on it: historical 'gt'/'casino' settlement rows are P&L that was
   * already counted, not money handed over.
   */
  async #playerTransferTotals(playerIds, { from, to }) {
    const totals = new Map();
    const unique = [...new Set(playerIds.map(Number).filter(Number.isInteger))];
    if (!unique.length) return totals;

    const rows = await this.models.StaffTransfers.findAll({
      where: {
        transfer_type: 'transfer',
        [Op.or]: [
          { to_type: 'user', to_id: unique },
          { from_type: 'user', from_id: unique },
        ],
        ...this.#dateWhere('created_at', from, to),
      },
      attributes: ['from_type', 'from_id', 'to_type', 'to_id', 'amount'],
      raw: true,
    });

    for (const row of rows) {
      const toPlayer = row.to_type === 'user';
      const key = String(toPlayer ? row.to_id : row.from_id);
      if (!totals.has(key)) totals.set(key, { funded: 0n, collected: 0n });
      const bucket = totals.get(key);
      const minor = money.toMinorQuantised(row.amount ?? '0');
      if (toPlayer) bucket.funded += minor;
      else bucket.collected += minor;
    }

    return totals;
  }

  async #nameLookup(transfers) {
    const staffIds = new Set();
    const userIds = new Set();
    for (const row of transfers) {
      (row.from_type === 'staff' ? staffIds : userIds).add(row.from_id);
      (row.to_type === 'staff' ? staffIds : userIds).add(row.to_id);
    }

    const [staffNames, userNames] = await Promise.all([
      this.#staffNames([...staffIds]),
      this.#userNames([...userIds]),
    ]);

    const lookup = new Map();
    for (const [id, name] of staffNames) lookup.set(`staff:${id}`, name);
    for (const [id, name] of userNames) lookup.set(`user:${id}`, name);
    return lookup;
  }

  async #staffNames(ids) {
    const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (!unique.length) return new Map();
    const rows = await this.models.Staff.findAll({ where: { id: unique }, attributes: ['id', 'name'], raw: true });
    return new Map(rows.map((r) => [String(r.id), r.name]));
  }

  async #userNames(ids) {
    const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
    if (!unique.length) return new Map();
    const rows = await this.models.Users.findAll({ where: { id: unique }, attributes: ['id', 'name'], raw: true });
    return new Map(rows.map((r) => [String(r.id), r.name]));
  }

  async #gameNames(uuids) {
    const unique = [...new Set(uuids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.models.GisGames.findAll({ where: { uuid: unique }, attributes: ['uuid', 'name'], raw: true });
    return new Map(rows.map((r) => [r.uuid, r.name]));
  }

  /**
   * Some legacy bet columns hold the literal STRING "NULL".
   *
   * Showing "NULL" in a Selection column helps nobody — fall through to the
   * next candidate, then to a dash. Legacy's `text()` helper, kept.
   */
  #text(...values) {
    for (const value of values) {
      const text = value == null ? '' : String(value).trim();
      if (text && text.toLowerCase() !== 'null' && text.toLowerCase() !== 'undefined') return text;
    }
    return '—';
  }
}

module.exports = { StatementsService };
