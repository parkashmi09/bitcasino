'use strict';

const { Op, fn, col, literal, lockRow } = require('@ibitplay/db');

const {
  BET_STATUS,
  RESULT_STATUS,
  MARKET_GAME_TYPES,
  GAME_TYPE,
  SETTLEMENT_CURRENCY,
} = require('./settlement.constants');

/**
 * Every database access the settlement module makes.
 *
 * All of it is Sequelize against the registered models — the legacy module's
 * raw `pg.query` calls are gone, along with the string-concatenated WHERE
 * clauses it built by hand (`voidResult` appended `AND game_type = $3` to a
 * template literal and pushed onto a shared values array; one reordering and
 * the placeholders silently point at the wrong column).
 *
 * `literal()` survives in exactly two places, both marked below, for SQL that
 * Sequelize has no expression for: an ordered aggregate, and a
 * `SET col = col - :delta` guard. Neither interpolates user input — every
 * value goes through bind parameters or Sequelize's own escaping.
 *
 * Nothing here knows about HTTP. Nothing here decides policy. It reads and
 * writes rows, takes the locks it is told to take, and returns plain objects.
 */
class SettlementRepository {
  constructor({ models, db }) {
    this.models = models;
    this.db = db;
    this.sequelize = db.sequelize;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  READ — open markets awaiting settlement
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Match-odds and bookmaker markets that still have open bets, one row per
   * market. Replaces the hand-written GROUP BY in `getMoMatches`.
   *
   * `counts` and `runners` are "the value from the most recent bet in the
   * group" — a genuinely ordered aggregate. Sequelize's `fn()` cannot express
   * `ARRAY_AGG(x ORDER BY y)`, so those two attributes use `literal()` over
   * fixed column names with no interpolation.
   */
  async aggregateMarketMatches({ limit, offset }) {
    const { SportsBet } = this.models;

    return SportsBet.findAll({
      attributes: [
        'match_id',
        'eventid',
        'game_type',
        'market_type',
        [fn('MAX', col('match_title')), 'match_title'],
        [fn('MAX', col('team_one')), 'team_one'],
        [fn('MAX', col('team_two')), 'team_two'],
        [fn('COUNT', col('id')), 'totalbets'],
        // Ordered aggregates — no Sequelize equivalent. Static SQL, no input.
        [literal('(ARRAY_AGG("counts" ORDER BY "created_at" DESC))[1]'), 'counts'],
        [literal('(ARRAY_AGG("runners" ORDER BY "created_at" DESC))[1]'), 'runners'],
      ],
      where: {
        game_type: { [Op.in]: MARKET_GAME_TYPES },
        status: BET_STATUS.OPEN,
        match_id: { [Op.ne]: null },
        eventid: { [Op.ne]: null },
      },
      group: ['match_id', 'eventid', 'game_type', 'market_type'],
      order: [[fn('MAX', col('created_at')), 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /**
   * Fancy markets with open bets, grouped down to the selection. Replaces the
   * first query in `getFanOpenBets`.
   */
  async aggregateFancyGroups({ limit, offset }) {
    const { SportsBet } = this.models;

    return SportsBet.findAll({
      attributes: [
        'match_id',
        'eventid',
        'market_type',
        'selection_name',
        'game_type',
        [fn('MAX', col('match_title')), 'match_title'],
        [fn('MAX', col('event_name')), 'event_name'],
        [fn('COUNT', col('id')), 'totalbets'],
        [fn('MAX', col('counts')), 'counts'],
      ],
      where: {
        game_type: GAME_TYPE.FANCY,
        status: BET_STATUS.OPEN,
        match_id: { [Op.ne]: null },
        eventid: { [Op.ne]: null },
      },
      group: ['match_id', 'eventid', 'market_type', 'selection_name', 'game_type'],
      order: [[fn('MAX', col('created_at')), 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  /**
   * The open bets belonging to a set of market groups.
   *
   * Legacy built this by concatenating one `(a = $1 AND b = $2 AND ...)` block
   * per group into a template literal while manually tracking placeholder
   * offsets. Here it is `Op.or` over a list of plain objects, so the parameters
   * cannot drift out of alignment with the columns.
   */
  async findOpenBetsForGroups(groups) {
    if (!groups.length) return [];
    const { SportsBet } = this.models;

    return SportsBet.findAll({
      where: {
        status: BET_STATUS.OPEN,
        [Op.or]: groups.map((g) => ({
          match_id: g.match_id,
          eventid: g.eventid,
          market_type: g.market_type,
          selection_name: g.selection_name,
          game_type: g.game_type,
        })),
      },
      order: [['created_at', 'ASC']],
      raw: true,
    });
  }

  /** Open bets on one market, for the pre-settlement review screen. */
  async findOpenBetsForMarket({ matchId, marketType, gameType, selectionName }) {
    const { SportsBet } = this.models;

    return SportsBet.findAll({
      attributes: [
        'id',
        'user_id',
        'bet_type',
        'selection_name',
        'market_type',
        'game_type',
        'odds',
        'stake_amount',
        'liability',
        'status',
        'match_id',
        'eventid',
        'created_at',
      ],
      where: {
        match_id: matchId,
        market_type: marketType,
        status: BET_STATUS.OPEN,
        // Legacy expressed these as `($3::text IS NULL OR game_type = $3)`.
        // Omitting the key entirely is the same thing without the cast.
        ...(gameType ? { game_type: gameType } : {}),
        ...(selectionName ? { selection_name: selectionName } : {}),
      },
      order: [['created_at', 'DESC']],
      raw: true,
    });
  }

  /** A player's own settled bets. New endpoint — legacy had no player-facing view. */
  async findSettledBetsForUser({ userId, matchId, gameType, limit, offset }) {
    const { SportsBet } = this.models;

    return SportsBet.findAndCountAll({
      where: {
        user_id: userId,
        status: BET_STATUS.CLOSED,
        ...(matchId ? { match_id: matchId } : {}),
        ...(gameType ? { game_type: gameType } : {}),
      },
      order: [['match_end_time', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Username resolution
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Map user ids to display names in one query.
   *
   * `credits_ledger.user_id` is TEXT while `users.id` is BIGINT, which is why
   * the legacy queries carry `cl.user_id::text = u.id::text`. That cast makes
   * the join unindexable on both sides — a guaranteed sequential scan of
   * `users` for every settled-market screen. Resolving the names in a second
   * keyed lookup is one extra round trip and uses the primary key index.
   */
  async mapUsernames(userIds) {
    const ids = [...new Set(userIds.filter((id) => id !== null && id !== undefined).map(String))];
    if (!ids.length) return new Map();

    const rows = await this.models.Users.findAll({
      attributes: ['id', 'name'],
      where: { id: { [Op.in]: ids } },
      raw: true,
    });

    return new Map(rows.map((r) => [String(r.id), r.name]));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  WRITE — declaring a result
  // ══════════════════════════════════════════════════════════════════════

  /** Has this market already been declared? Guards the double-settle case. */
  async findDeclaredResult({ matchId, marketType, gameType, selectionName }, transaction) {
    return this.models.MannualResult.findOne({
      where: {
        match_id: matchId,
        market_type: marketType,
        game_type: gameType,
        ...(selectionName ? { fancyName: selectionName } : {}),
      },
      order: [['id', 'DESC']],
      transaction,
      raw: true,
    });
  }

  async createManualResult(data, transaction) {
    const row = await this.models.MannualResult.create(data, { transaction });
    return row.get({ plain: true });
  }

  /** Flip open bets on a market to `manual`, i.e. awaiting payout calculation. */
  async markBetsManual({ matchId, marketType, gameType, selectionName }, transaction) {
    const [affected] = await this.models.SportsBet.update(
      { status: BET_STATUS.MANUAL },
      {
        where: {
          match_id: matchId,
          market_type: marketType,
          game_type: gameType,
          status: BET_STATUS.OPEN,
          ...(selectionName ? { selection_name: selectionName } : {}),
        },
        transaction,
      }
    );
    return affected;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  WRITE — voiding before settlement
  // ══════════════════════════════════════════════════════════════════════

  /** Build the market filter shared by the void read and the void write. */
  static marketFilter({ matchId, marketType, gameType, selectionName }) {
    return {
      match_id: matchId,
      market_type: marketType,
      status: BET_STATUS.OPEN,
      ...(gameType ? { game_type: gameType } : {}),
      ...(selectionName ? { selection_name: selectionName } : {}),
    };
  }

  /** Distinct players holding open bets on a market. */
  async findAffectedUserIds(filter, transaction) {
    const rows = await this.models.SportsBet.findAll({
      attributes: [[fn('DISTINCT', col('user_id')), 'user_id']],
      where: filter,
      transaction,
      raw: true,
    });
    return rows.map((r) => r.user_id).filter((id) => id !== null && id !== undefined);
  }

  async findExposures({ userId, matchId, gameType }, transaction) {
    return this.models.UserExposures.findAll({
      where: { user_id: userId, match_id: matchId, game_type: gameType },
      transaction,
      raw: true,
    });
  }

  async deleteExposures({ userId, matchId, gameType }, transaction) {
    return this.models.UserExposures.destroy({
      where: { user_id: userId, match_id: matchId, game_type: gameType },
      transaction,
    });
  }

  /**
   * Lock a player's credits row and return the INR balance.
   *
   * Legacy read the balance with a plain SELECT and wrote it into the ledger's
   * `balance` column, with nothing holding the row in between — so the audit
   * trail could record a balance that never existed at any instant. This takes
   * the row lock first, which is the whole point of writing a balance down.
   */
  async lockCredits(uid, transaction) {
    return lockRow(this.models.Credits, { uid }, transaction, { attributes: ['uid', 'inr'] });
  }

  /**
   * Add to a player's INR balance atomically.
   *
   * `increment` emits `SET inr = inr + :delta` — the read and the write are one
   * statement, so two concurrent refunds cannot both compute from the same
   * starting figure.
   */
  async creditInr(uid, amount, transaction) {
    await this.models.Credits.increment({ inr: amount }, { where: { uid }, transaction });
  }

  /**
   * Subtract from a player's INR balance, refusing to go below zero.
   *
   * The `>= 0` guard lives in the WHERE clause, not in JavaScript: checking in
   * JS and then updating is a read-then-write race, and legacy's version of
   * this (`Math.max(0, balance - amount)`) clamped the number written to
   * *history* while decrementing the column unclamped — history said 0, the
   * balance said -50.
   *
   * @returns {boolean} false when the balance was too low and nothing changed.
   */
  async debitInrGuarded(uid, amount, transaction) {
    const [, affected] = await this.models.Credits.update(
      // literal is required for a self-referencing UPDATE; `amount` is bound.
      { inr: literal('inr - :debitAmount') },
      {
        where: { uid, inr: { [Op.gte]: amount } },
        replacements: { debitAmount: amount },
        transaction,
      }
    );
    return affected > 0;
  }

  /** Close bets as refunded — the terminal state for a voided market. */
  async closeBetsAsRefunded(filter, transaction) {
    const [affected] = await this.models.SportsBet.update(
      {
        status: BET_STATUS.CLOSED,
        result_status: RESULT_STATUS.REFUNDED,
        match_end_time: new Date(),
      },
      { where: filter, transaction }
    );
    return affected;
  }

  /** Take a row lock on one open bet before voiding it. */
  async lockOpenBet(betId, transaction) {
    return lockRow(this.models.SportsBet, { id: betId, status: BET_STATUS.OPEN }, transaction);
  }

  /** Other open bets by the same player on the same market. */
  async countOtherOpenBets({ betId, userId, matchId, marketType }, transaction) {
    return this.models.SportsBet.count({
      where: {
        match_id: matchId,
        market_type: marketType,
        user_id: userId,
        status: BET_STATUS.OPEN,
        id: { [Op.ne]: betId },
      },
      transaction,
    });
  }

  async closeBetById(betId, transaction) {
    const [affected] = await this.models.SportsBet.update(
      {
        status: BET_STATUS.CLOSED,
        result_status: RESULT_STATUS.REFUNDED,
        match_end_time: new Date(),
      },
      { where: { id: betId }, transaction }
    );
    return affected;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  READ — already-settled markets
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Settled markets inside the void window, one row per market.
   *
   * The 30-hour cut-off was hardcoded in four separate legacy queries; it now
   * arrives as `sinceHours` from config. The join to `SportsBet` is a real
   * association (`bet_id` -> `id`, both numeric), so match titles and team
   * names come back without a cast.
   */
  async aggregateSettledMarkets({ limit, offset, search, sinceHours }) {
    const { CreditsLedger, SportsBet } = this.models;
    const since = hoursAgo(sinceHours);

    const searchClause = search
      ? {
          [Op.or]: [
            { match_id: { [Op.iLike]: `%${search}%` } },
            { market_type: { [Op.iLike]: `%${search}%` } },
            { description: { [Op.iLike]: `%${search}%` } },
            { '$bet.match_title$': { [Op.iLike]: `%${search}%` } },
            { '$bet.team_one$': { [Op.iLike]: `%${search}%` } },
            { '$bet.team_two$': { [Op.iLike]: `%${search}%` } },
          ],
        }
      : {};

    return CreditsLedger.findAll({
      attributes: [
        'match_id',
        'market_type',
        'sport_id',
        [fn('MAX', col('CreditsLedger.eventid')), 'eventid'],
        [fn('MAX', col('CreditsLedger.description')), 'description'],
        [fn('COUNT', col('CreditsLedger.id')), 'total_entries'],
        [fn('COUNT', fn('DISTINCT', col('CreditsLedger.user_id'))), 'total_users'],
        [fn('SUM', col('CreditsLedger.netamount')), 'total_netamount'],
        [fn('MAX', col('CreditsLedger.created_at')), 'last_settled_at'],
        [fn('MAX', col('bet.match_title')), 'match_title'],
        [fn('MAX', col('bet.team_one')), 'team_one'],
        [fn('MAX', col('bet.team_two')), 'team_two'],
        [fn('MAX', col('bet.game_type')), 'game_type'],
      ],
      include: [{ model: SportsBet, as: 'bet', attributes: [], required: false }],
      where: {
        bet_id: { [Op.ne]: null },
        match_id: { [Op.ne]: null },
        sport_id: { [Op.ne]: null },
        created_at: { [Op.gte]: since },
        ...searchClause,
      },
      group: ['CreditsLedger.match_id', 'CreditsLedger.market_type', 'CreditsLedger.sport_id'],
      order: [[fn('MAX', col('CreditsLedger.created_at')), 'DESC']],
      limit,
      offset,
      // Without this Sequelize wraps the aggregate in a subquery and the GROUP
      // BY no longer lines up with the selected columns.
      subQuery: false,
      raw: true,
    });
  }

  /** Individual settlement entries for one market, with the bet they settled. */
  async findSettledEntries({ matchId, marketType, sinceHours }) {
    const { CreditsLedger, SportsBet } = this.models;

    return CreditsLedger.findAll({
      attributes: [
        'id',
        'bet_id',
        'user_id',
        'amount',
        'netamount',
        'profit',
        'loss',
        'commission',
        'description',
        'market_type',
        'sport_id',
        'match_id',
        'eventid',
        'job_id',
        'created_at',
      ],
      include: [
        {
          model: SportsBet,
          as: 'bet',
          attributes: ['bet_type', 'selection_name', 'odds', 'stake_amount', 'game_type', 'result_status'],
          required: false,
        },
      ],
      where: {
        match_id: matchId,
        market_type: marketType,
        bet_id: { [Op.ne]: null },
        sport_id: { [Op.ne]: null },
        created_at: { [Op.gte]: hoursAgo(sinceHours) },
      },
      order: [['created_at', 'DESC']],
      raw: true,
      nest: true,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  WRITE — voiding after settlement
  // ══════════════════════════════════════════════════════════════════════

  /** Settlement rows for a market, locked for the reversal. */
  async findLedgerEntriesForMarket({ matchId, marketType }, transaction) {
    return this.models.CreditsLedger.findAll({
      where: {
        match_id: matchId,
        market_type: marketType,
        bet_id: { [Op.ne]: null },
        sport_id: { [Op.ne]: null },
      },
      order: [['id', 'ASC']],
      transaction,
      lock: transaction?.LOCK?.UPDATE,
      raw: true,
    });
  }

  async findLedgerEntryById(ledgerId, transaction) {
    return this.models.CreditsLedger.findOne({
      where: { id: ledgerId, bet_id: { [Op.ne]: null } },
      transaction,
      lock: transaction?.LOCK?.UPDATE,
      raw: true,
    });
  }

  /** Has this market already been reversed? Stops a double reversal. */
  async countVoidMarkers({ matchId, marketType, reason }, transaction) {
    return this.models.CreditsLedger.count({
      where: { match_id: matchId, market_type: marketType, reason },
      transaction,
    });
  }

  /**
   * Walk back one player's lifetime totals by the amounts a settlement added.
   *
   * `gt` is the lifetime sports P&L that every agent roll-up is built on, so a
   * void that skips it leaves the whole reporting tree counting a market that
   * no longer exists. `decrement` keeps each column's update atomic.
   */
  async reverseUserTotals({ userId, profit, loss, netamount }, transaction) {
    await this.models.Users.decrement(
      {
        net_win: profit,
        net_loss: loss,
        total_profit: netamount,
        gt: netamount,
      },
      { where: { id: userId }, transaction }
    );
  }

  async deleteLedgerEntry(ledgerId, transaction) {
    return this.models.CreditsLedger.destroy({ where: { id: ledgerId }, transaction });
  }

  async markBetsVoidedAfterSettlement({ matchId, marketType }, transaction) {
    const [affected] = await this.models.SportsBet.update(
      { result_status: RESULT_STATUS.VOIDED_AFTER_SETTLEMENT },
      {
        where: { match_id: matchId, market_type: marketType, status: BET_STATUS.CLOSED },
        transaction,
      }
    );
    return affected;
  }

  async markBetVoidedAfterSettlement(betId, transaction) {
    const [affected] = await this.models.SportsBet.update(
      { result_status: RESULT_STATUS.VOIDED_AFTER_SETTLEMENT },
      { where: { id: betId }, transaction }
    );
    return affected;
  }

  /**
   * Write the zero-amount audit row that records why a balance moved.
   *
   * It carries no money itself — the reversal already did that — but it is what
   * makes a voided market visible in a player's statement instead of the
   * settlement entry simply vanishing from history.
   */
  async writeVoidMarker(entry, transaction) {
    const row = await this.models.CreditsLedger.create(
      {
        currency: SETTLEMENT_CURRENCY,
        amount: 0,
        netamount: 0,
        profit: 0,
        loss: 0,
        closing: 0,
        commission: 0,
        ...entry,
      },
      { transaction }
    );
    return row.get({ plain: true });
  }
}

/** `NOW() - INTERVAL 'n hours'`, computed in Node so the value is a bind parameter. */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

module.exports = { SettlementRepository };
