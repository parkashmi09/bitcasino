'use strict';

const errors = require('./settlement.errors');
const { SettlementRepository } = require('./settlement.repository');
const {
  BET_STATUS,
  SELECTION_SCOPED_MARKETS,
  FANCY_MARKET_TYPES,
  OTHER_BUCKET,
  LEDGER_REASON,
  SETTLEMENT_CURRENCY,
} = require('./settlement.constants');

/**
 * Settlement business rules.
 *
 * No `req`, no `res`, no SQL. That is what lets the background worker call
 * `settleMarket()` directly instead of the legacy arrangement where the only
 * way to settle was to make an HTTP request to your own process.
 *
 * Transaction discipline, which is the part legacy got wrong:
 *
 *   Every write below runs inside `db.transaction(...)` — a real pooled
 *   transaction with its own connection. Legacy issued `pg.query('BEGIN')` on
 *   the SHARED client, and `legacy/General/Model/pool.js` warns about exactly
 *   this in its own header: one request's BEGIN/COMMIT would wrap another
 *   request's queries on the same connection. Under load a settlement could be
 *   committed — or rolled back — by an unrelated request.
 */
class SettlementService {
  constructor({ models, db, config, logger, clients }) {
    this.repo = new SettlementRepository({ models, db });
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.clients = clients;
    this.voidWindowHours = config.SPORTS_VOID_WINDOW_HOURS;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Open markets
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/internalsettle/momatches
   * @legacy GET /sportsbetting/momatches
   *
   * Declared twice. `sportsbet/routes.js` carries its own copy of most of the
   * settlement surface — same queries, different file, scoped by an
   * `x-staff-id` request header instead of by anything verified.
   */
  async listMarketMatches({ limit, offset }) {
    const rows = await this.repo.aggregateMarketMatches({ limit, offset });

    return rows.map((r) => ({
      matchId: r.match_id,
      eventId: r.eventid,
      gameType: r.game_type,
      marketType: r.market_type,
      matchTitle: r.match_title,
      teamOne: r.team_one,
      teamTwo: r.team_two,
      totalBets: toInt(r.totalbets),
      counts: r.counts,
      runners: r.runners,
    }));
  }

  /**
   * Fancy markets with their open bets, bucketed by market type.
   *
   * @legacy GET /api/internalsettle/fanmatches
   * @legacy GET /sportsbetting/fanmatches
   * @legacy GET /sportsbetting/fancynotsettle
   */
  async listFancyMatches({ limit, offset }) {
    const groups = await this.repo.aggregateFancyGroups({ limit, offset });

    // Seed every bucket so the response shape is stable whether or not a given
    // market has action — the admin UI renders tabs off these keys.
    const payload = Object.fromEntries(FANCY_MARKET_TYPES.map((m) => [m, []]));
    payload[OTHER_BUCKET] = [];

    if (!groups.length) return payload;

    const bets = await this.repo.findOpenBetsForGroups(groups);

    // Fancy markets key on selection (each session is its own market); anything
    // else merges its selections into one `others` entry.
    const groupMap = new Map();

    for (const g of groups) {
      const isFancy = FANCY_MARKET_TYPES.includes(g.market_type);
      const key = groupKeyFor(g, isFancy);

      const existing = groupMap.get(key);
      if (existing) {
        existing.totalBets += toInt(g.totalbets);
        continue;
      }

      groupMap.set(key, {
        bucket: isFancy ? g.market_type : OTHER_BUCKET,
        matchId: g.match_id,
        eventId: g.eventid,
        matchTitle: g.match_title,
        eventName: g.event_name || null,
        marketType: g.market_type,
        ...(isFancy ? { selectionName: g.selection_name } : {}),
        gameType: g.game_type,
        totalBets: toInt(g.totalbets),
        counts: toNumberOrNull(g.counts),
        bets: [],
      });
    }

    for (const b of bets) {
      const isFancy = FANCY_MARKET_TYPES.includes(b.market_type);
      const bucket = groupMap.get(groupKeyFor(b, isFancy));
      if (!bucket) continue;

      bucket.bets.push({
        id: b.id,
        userId: b.user_id,
        betType: b.bet_type,
        selectionName: b.selection_name,
        marketType: b.market_type,
        gameType: b.game_type,
        teamOne: b.team_one,
        teamTwo: b.team_two,
        odds: toNumberOrNull(b.odds),
        stakeAmount: toNumberOrNull(b.stake_amount),
        originalCurrency: b.original_currency,
        originalAmount: toNumberOrNull(b.original_amount),
        usdAmount: toNumberOrNull(b.usd_amount),
        liability: toNumberOrNull(b.liability),
        status: b.status,
        createdAt: b.created_at,
        eventName: b.event_name || null,
        counts: toNumberOrNull(b.counts),
        runners: b.runners || null,
      });
    }

    for (const entry of groupMap.values()) {
      const { bucket, ...rest } = entry;
      (payload[bucket] || payload[OTHER_BUCKET]).push(rest);
    }

    return payload;
  }

  /** @legacy GET /api/internalsettle/open-bets */
  async listOpenBets({ matchId, marketType, gameType, selectionName }) {
    const bets = await this.repo.findOpenBetsForMarket({ matchId, marketType, gameType, selectionName });
    const names = await this.repo.mapUsernames(bets.map((b) => b.user_id));

    return bets.map((b) => ({
      id: b.id,
      userId: b.user_id,
      username: names.get(String(b.user_id)) || String(b.user_id),
      betType: b.bet_type,
      selectionName: b.selection_name,
      marketType: b.market_type,
      gameType: b.game_type,
      odds: toNumberOrNull(b.odds),
      stakeAmount: toNumberOrNull(b.stake_amount),
      liability: toNumberOrNull(b.liability),
      status: b.status,
      matchId: b.match_id,
      eventId: b.eventid,
      createdAt: b.created_at,
    }));
  }

  /** A player's own settled bets. No legacy equivalent. */
  async listSettledBetsForUser({ userId, matchId, gameType, limit, offset }) {
    const { rows, count } = await this.repo.findSettledBetsForUser({ userId, matchId, gameType, limit, offset });

    return {
      count,
      rows: rows.map((b) => ({
        id: b.id,
        matchId: b.match_id,
        eventId: b.eventid,
        matchTitle: b.match_title,
        marketType: b.market_type,
        gameType: b.game_type,
        selectionName: b.selection_name,
        betType: b.bet_type,
        odds: toNumberOrNull(b.odds),
        stakeAmount: toNumberOrNull(b.stake_amount),
        resultStatus: b.result_status,
        settledAt: b.match_end_time,
      })),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Declaring a result
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Record a market result and move its open bets to `manual`.
   *
   * @legacy POST /api/internalsettle/declareresult
   * @legacy POST /sportsbetting/manual-settlement
   * @legacy POST /sportsbetting/fancymanualsettle
   * @legacy POST /sportsbetting/calculate-payouts
   * @legacy POST /sportsbetting/fanpayouts
   * @legacy GET /sportsbetting/settle
   */
  async declareResult(input) {
    const { eventid, match_id, match_title, game_type, market_type, winnerName, winnerId, fancyName } = input;

    // Per-selection markets settle one session at a time. Without the selection
    // the UPDATE below would match every session on the match and settle them
    // all against one result.
    const selectionScoped = SELECTION_SCOPED_MARKETS.includes(market_type);
    if (selectionScoped && !fancyName) {
      throw errors.SELECTION_REQUIRED({ marketType: market_type });
    }
    if (!winnerId && !winnerName && !fancyName) {
      throw errors.RESULT_REQUIRED({ marketType: market_type });
    }

    const selectionName = selectionScoped ? fancyName : undefined;

    return this.db.transaction(async (transaction) => {
      // Serialise settlement per market across every process. Two operators
      // clicking "declare" at once used to run both inserts and both updates;
      // the second found no open bets and reported success having done nothing.
      const lockKey = `settlement:${match_id}:${market_type}:${selectionName || '*'}`;
      const { acquired } = await this.db.advisoryLock(lockKey, async () => true, { transaction });
      if (!acquired) throw errors.SETTLEMENT_IN_PROGRESS({ matchId: match_id, marketType: market_type });

      const alreadyDeclared = await this.repo.findDeclaredResult(
        { matchId: match_id, marketType: market_type, gameType: game_type, selectionName },
        transaction
      );
      if (alreadyDeclared) {
        throw errors.MARKET_ALREADY_SETTLED({
          matchId: match_id,
          marketType: market_type,
          declaredAt: alreadyDeclared.created_at,
        });
      }

      const manualResult = await this.repo.createManualResult(
        {
          eventid,
          match_id,
          match_title,
          game_type,
          market_type,
          winnerName: winnerName ?? null,
          winnerId: winnerId ?? null,
          fancyName: fancyName ?? null,
        },
        transaction
      );

      const updatedBets = await this.repo.markBetsManual(
        { matchId: match_id, marketType: market_type, gameType: game_type, selectionName },
        transaction
      );

      // Legacy reported success with `updatedBets: 0`, which reads as "settled"
      // to an operator but means the filter matched nothing — a typo'd market
      // type or an already-settled market. Rolling back makes it visible.
      if (updatedBets === 0) {
        throw errors.NO_OPEN_BETS({ matchId: match_id, marketType: market_type, selectionName });
      }

      return { manualResult, updatedBets };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Voiding before settlement
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Void a whole market: refund every player's held exposure and close the bets.
   *
   * @legacy POST /api/internalsettle/void
   * @legacy POST /sportsbetting/fancyrefundsettle
   */
  async voidMarket({ match_id, market_type, gametype, selection_name }) {
    const filter = SettlementRepository.marketFilter({
      matchId: match_id,
      marketType: market_type,
      gameType: gametype,
      selectionName: selection_name,
    });

    return this.db.transaction(async (transaction) => {
      const userIds = await this.repo.findAffectedUserIds(filter, transaction);
      if (!userIds.length) throw errors.NO_OPEN_BETS({ matchId: match_id, marketType: market_type });

      let refundedTotal = 0;

      for (const userId of userIds) {
        const refunded = await this.#releaseExposure(
          { userId, matchId: match_id, gameType: market_type },
          transaction
        );
        refundedTotal += refunded;
      }

      const closedBets = await this.repo.closeBetsAsRefunded(filter, transaction);

      return { affectedUsers: userIds.length, closedBets, refundedTotal: round2(refundedTotal) };
    });
  }

  /**
   * Void one open bet.
   *
   * @legacy POST /api/internalsettle/void-single-bet
   * @legacy DELETE /sportsbetting/admin/bets/:id
   * @legacy PUT /sportsbetting/admin/bets/:id/status
   * @legacy DELETE /admin/bets/:betId
   * @legacy PUT /admin/bets/:betId/status
   */
  async voidSingleBet({ bet_id }) {
    return this.db.transaction(async (transaction) => {
      const bet = await this.repo.lockOpenBet(bet_id, transaction);
      if (!bet) throw errors.BET_NOT_FOUND({ betId: bet_id });

      const userId = bet.user_id;
      const matchId = bet.match_id;
      const marketType = bet.market_type;

      // Exposure is held per market, not per bet. Releasing it while the player
      // still has other open bets on the market would hand back money that is
      // still at risk — so only the last bet out releases it.
      const otherOpenBets = await this.repo.countOtherOpenBets(
        { betId: bet_id, userId, matchId, marketType },
        transaction
      );

      let refunded = 0;
      if (otherOpenBets === 0) {
        refunded = await this.#releaseExposure({ userId, matchId, gameType: marketType }, transaction);
      }

      await this.repo.closeBetById(bet_id, transaction);

      return { betId: bet_id, userId, refunded: round2(refunded), exposureReleased: otherOpenBets === 0 };
    });
  }

  /**
   * Refund a player's held exposure on a market and drop the exposure rows.
   *
   * Exposure is stored as the worst-case outcome, so it is negative; the
   * refund is the magnitude of the most negative row. A market with no
   * negative exposure refunds nothing, which is correct — nothing was held.
   */
  async #releaseExposure({ userId, matchId, gameType }, transaction) {
    const exposures = await this.repo.findExposures({ userId, matchId, gameType }, transaction);
    if (!exposures.length) return 0;

    const worst = exposures.reduce((min, e) => Math.min(min, Number(e.exposure_amount) || 0), 0);

    let refund = 0;
    if (worst < 0) {
      refund = Math.abs(worst);
      // Lock the credits row before touching it so the ledger and the balance
      // agree even under concurrent settlement of two markets for one player.
      await this.repo.lockCredits(userId, transaction);
      await this.repo.creditInr(userId, refund, transaction);
    }

    await this.repo.deleteExposures({ userId, matchId, gameType }, transaction);
    return refund;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Settled markets
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /api/internalsettle/settled-markets */
  async listSettledMarkets({ limit, offset, search }) {
    const rows = await this.repo.aggregateSettledMarkets({
      limit,
      offset,
      search,
      sinceHours: this.voidWindowHours,
    });

    return rows.map((r) => ({
      matchId: r.match_id,
      marketType: r.market_type,
      sportId: r.sport_id,
      eventId: r.eventid,
      description: r.description,
      matchTitle: r.match_title,
      teamOne: r.team_one,
      teamTwo: r.team_two,
      gameType: r.game_type,
      totalEntries: toInt(r.total_entries),
      totalUsers: toInt(r.total_users),
      totalNetAmount: toNumber(r.total_netamount),
      lastSettledAt: r.last_settled_at,
    }));
  }

  /** @legacy GET /api/internalsettle/settled-bets */
  async listSettledBets({ matchId, marketType }) {
    const entries = await this.repo.findSettledEntries({
      matchId,
      marketType,
      sinceHours: this.voidWindowHours,
    });
    const names = await this.repo.mapUsernames(entries.map((e) => e.user_id));

    return entries.map((e) => ({
      ledgerId: e.id,
      betId: e.bet_id,
      userId: e.user_id,
      username: names.get(String(e.user_id)) || String(e.user_id),
      amount: toNumber(e.amount),
      netamount: toNumber(e.netamount),
      profit: toNumber(e.profit),
      loss: toNumber(e.loss),
      commission: toNumber(e.commission),
      description: e.description,
      marketType: e.market_type,
      sportId: e.sport_id,
      matchId: e.match_id,
      eventId: e.eventid,
      jobId: e.job_id,
      createdAt: e.created_at,
      betType: e.bet?.bet_type ?? null,
      selectionName: e.bet?.selection_name ?? null,
      odds: toNumberOrNull(e.bet?.odds),
      stakeAmount: toNumberOrNull(e.bet?.stake_amount),
      gameType: e.bet?.game_type ?? null,
      resultStatus: e.bet?.result_status ?? null,
    }));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Voiding after settlement
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Reverse a settled market: undo every payout, walk back lifetime totals,
   * delete the settlement rows and leave an audit marker per player.
   *
   * @legacy POST /api/internalsettle/void-market-after-settlement
   */
  async voidMarketAfterSettlement({ match_id, market_type }) {
    return this.db.transaction(async (transaction) => {
      const alreadyVoided = await this.repo.countVoidMarkers(
        { matchId: match_id, marketType: market_type, reason: LEDGER_REASON.VOID_AFTER_SETTLEMENT },
        transaction
      );
      if (alreadyVoided > 0) throw errors.ALREADY_VOIDED({ matchId: match_id, marketType: market_type });

      const entries = await this.repo.findLedgerEntriesForMarket(
        { matchId: match_id, marketType: market_type },
        transaction
      );
      if (!entries.length) throw errors.NO_SETTLED_ENTRIES({ matchId: match_id, marketType: market_type });

      this.#assertWithinVoidWindow(entries);

      for (const entry of entries) {
        await this.#reverseLedgerEntry(entry, transaction);
      }

      await this.repo.markBetsVoidedAfterSettlement({ matchId: match_id, marketType: market_type }, transaction);

      const userIds = [...new Set(entries.map((e) => String(e.user_id)))];

      for (const userId of userIds) {
        const sample = entries.find((e) => String(e.user_id) === userId);
        const credits = await this.repo.lockCredits(userId, transaction);

        await this.repo.writeVoidMarker(
          {
            user_id: userId,
            reason: LEDGER_REASON.VOID_AFTER_SETTLEMENT,
            description: `Market voided after settlement; match_id=${match_id}; market_type=${market_type}`,
            match_id,
            market_type,
            sport_id: sample?.sport_id ?? null,
            eventid: sample?.eventid ?? null,
            balance: credits?.inr ?? 0,
          },
          transaction
        );
      }

      return { processedEntries: entries.length, affectedUsers: userIds.length };
    });
  }

  /**
   * Reverse one settled bet.
   *
   * @legacy POST /api/internalsettle/void-bet-after-settlement
   */
  async voidBetAfterSettlement({ ledger_id }) {
    return this.db.transaction(async (transaction) => {
      const entry = await this.repo.findLedgerEntryById(ledger_id, transaction);
      if (!entry) throw errors.LEDGER_ENTRY_NOT_FOUND({ ledgerId: ledger_id });

      this.#assertWithinVoidWindow([entry]);

      await this.#reverseLedgerEntry(entry, transaction);
      await this.repo.markBetVoidedAfterSettlement(entry.bet_id, transaction);

      const credits = await this.repo.lockCredits(entry.user_id, transaction);

      await this.repo.writeVoidMarker(
        {
          user_id: entry.user_id,
          reason: LEDGER_REASON.VOID_SINGLE_BET_AFTER_SETTLEMENT,
          description: `Bet #${entry.bet_id} voided after settlement`,
          match_id: entry.match_id,
          market_type: entry.market_type,
          sport_id: entry.sport_id,
          eventid: entry.eventid,
          job_id: entry.job_id,
          bet_id: entry.bet_id,
          // Legacy read `wallet[0].credit` here — a column that does not exist
          // on `credits`, so this always wrote null. The balance column is `inr`.
          balance: credits?.inr ?? 0,
        },
        transaction
      );

      return { ledgerId: ledger_id, betId: entry.bet_id, userId: entry.user_id };
    });
  }

  /**
   * Undo one settlement row: take the payout back, walk the player's lifetime
   * totals back by the same figures, and delete the row.
   *
   * The debit is guarded at `>= 0`. Legacy used an unguarded
   * `SET inr = inr - $1`, so voiding a market after the player had spent the
   * winnings drove the balance negative — and a negative balance is not a
   * state any other part of the platform is written to handle.
   */
  async #reverseLedgerEntry(entry, transaction) {
    const amount = toNumber(entry.amount);
    const netamount = toNumber(entry.netamount);
    const profit = toNumber(entry.profit);
    const loss = toNumber(entry.loss);

    if (amount !== 0) {
      await this.repo.lockCredits(entry.user_id, transaction);
      const ok = await this.repo.debitInrGuarded(entry.user_id, amount, transaction);

      if (!ok) {
        throw errors.REFUND_FAILED(
          { userId: entry.user_id, required: amount, ledgerId: entry.id },
          {
            message:
              'Cannot void: the player has already spent the winnings and the balance would go negative. ' +
              'Adjust the balance manually first, then retry.',
          }
        );
      }
    }

    await this.repo.reverseUserTotals(
      { userId: entry.user_id, profit, loss, netamount },
      transaction
    );

    await this.repo.deleteLedgerEntry(entry.id, transaction);
  }

  /**
   * Refuse to reverse a settlement older than the void window.
   *
   * The legacy read endpoints filtered to 30 hours, but the write endpoints did
   * not — so the UI would not show a two-day-old market while
   * `POST /void-market-after-settlement` would happily reverse it if the id
   * were supplied directly.
   */
  #assertWithinVoidWindow(entries) {
    const cutoff = Date.now() - this.voidWindowHours * 60 * 60 * 1000;
    const oldest = entries.reduce(
      (min, e) => Math.min(min, new Date(e.created_at).getTime()),
      Number.POSITIVE_INFINITY
    );

    if (Number.isFinite(oldest) && oldest < cutoff) {
      throw errors.VOID_WINDOW_EXPIRED({
        windowHours: this.voidWindowHours,
        settledAt: new Date(oldest).toISOString(),
      });
    }
  }
}

// ── Coercion helpers ───────────────────────────────────────────────────
// pg returns NUMERIC as a string to avoid precision loss. These endpoints are
// reporting views, so Number() matches the legacy response shape. Anything that
// MOVES money stays a string and goes through @ibitplay/common/money.

const toInt = (v) => Number.parseInt(v, 10) || 0;
const toNumber = (v) => Number(v) || 0;
const toNumberOrNull = (v) => (v === null || v === undefined ? null : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Fancy markets identify per selection; everything else merges its selections. */
function groupKeyFor(row, isFancy) {
  const base = `${row.match_id}||${row.eventid}||${row.market_type}||${row.game_type}`;
  return isFancy ? `${base}||${row.selection_name}` : base;
}

module.exports = { SettlementService, BET_STATUS, SETTLEMENT_CURRENCY };
