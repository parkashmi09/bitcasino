'use strict';

/**
 * The payout worker.
 *
 * @legacy sportsmain/cron/settlement.js — `pollOnce`, on a one-minute cron.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT IT IS
 *
 * The second half of settlement. `settlement.results.job.js` decides WHICH bets
 * have a declared result and queues them; this reads that queue and is the only
 * thing that pays anybody. Nothing else in the sports service credits a wallet
 * for a sports bet.
 *
 * Per claimed job: load its bets, split them into MO/BM groups (settled per
 * user+match, because exposure is held per market, not per bet) and FAN bets
 * (settled one at a time), then for each — resolve the winner, work out the
 * credit, move the wallet, write `marketwins`/`fanwins`, write the ledger row,
 * write the audit report, close the bets and drop the exposures.
 *
 * A group that cannot resolve yet returns `requeue` and the whole job goes back
 * to `queued` for the next tick. A group that throws does the same, so a
 * provider blip costs a minute, not a settlement.
 *
 * ── WHAT CHANGED FROM LEGACY, AND WHY ────────────────────────────────────
 *
 * The maths did not change. `settlement.rules.js` holds it, copied function for
 * function. The market-name tables did not change; `settlement.markets.js`
 * holds those. What changed is only how rows are read and written:
 *
 *   raw `pg.query` on a shared client  →  Sequelize models
 *   `pg.query('BEGIN' | 'COMMIT')`     →  `db.transaction(...)`
 *
 * That second one is not cosmetic. Legacy issued BEGIN and COMMIT as ordinary
 * queries on ONE process-wide client — `legacy/General/Model/pool.js` warns
 * about this in its own header — so one settlement's BEGIN wrapped whatever
 * else happened to be running, and its COMMIT committed that too. Every
 * `BEGIN`/`COMMIT` pair below is now a real transaction on its own connection,
 * with the same statements inside it.
 *
 * `processMobmGroup` had NO transaction in legacy — every write autocommits as
 * it goes — and it still has none here. Wrapping it would be a behaviour
 * change (a mid-group failure would roll back earlier bets' payouts instead of
 * leaving them settled), and this is a port, not a redesign.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { ResultsClient } = require('./settlement.resultsClient');
const { isNonFancyMarket, marketsforfancyCheck, ODDS_PRICED_FANCY_MARKETS } = require('./settlement.markets');
const {
  lower,
  num,
  namesMatch,
  matchesAny,
  runnerList,
  sideAliases,
  findExposureValue,
  resolveMobmWinner,
  resolveFanWinner,
  resolveFancyWinner,
  normalizeOdds,
  getOdds,
  getStake,
  isBack,
  isLay,
  normalizeExposure,
  moBmBetWinCredit,
} = require('./settlement.rules');

/**
 * Everything the settlement path touches, bound to one container.
 *
 * A class rather than a pile of closures because the legacy file kept all of
 * this in module scope against a global `pg` — which is exactly what made it
 * impossible to run two of them, or to run one under test.
 */
class PayoutRunner {
  constructor({ models, db, config, logger }) {
    this.models = models;
    this.db = db;
    this.Op = db.Op;
    this.config = config;
    this.logger = logger;
    this.results = new ResultsClient({ config, logger });

    this.BATCH_LIMIT = config.SPORTS_SETTLEMENT_BATCH;
    this.STALE_PROCESSING_MIN = config.SPORTS_SETTLEMENT_STALE_MIN;
    this.LEDGER_ZERO_ROWS = config.SPORTS_SETTLEMENT_LEDGER_ZERO_ROWS;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads and small writes
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy settlement.js `updateStaffParentBalUp`
   *
   * Staff balances live in `staff_balances` (inr), keyed by staff_id — NOT in
   * the staff table (which has neither staff_id nor a balance column).
   *
   * This is the one statement here that is NOT a model call: `staff_balances`
   * belongs to the admin domain, which sports-service deliberately does not
   * load (`SERVICE_DOMAINS['sports-service']` is sports + core + extended). The
   * legacy cron wrote it directly and settlement figures depend on it, so the
   * write is kept — as a parameterised statement, so the cross-domain reach is
   * visible rather than hidden behind a model that has no business being here.
   */
  async updateStaffParentBalUp(staffId, amount, transaction = null) {
    if (!staffId) return;

    await this.db.sequelize.query(
      'UPDATE staff_balances SET inr = inr + :amount WHERE staff_id = :staffId',
      {
        replacements: { amount: num(amount), staffId },
        type: this.db.QueryTypes.UPDATE,
        transaction: transaction || undefined,
      }
    );
  }

  /**
   * @legacy settlement.js `fetchManualResult`
   *
   * The operator-declared result, read out of `mannual_result`. Fancy markets
   * in `marketsforfancyCheck` narrow to one session by `fancyName`; everything
   * else takes the newest row for the market.
   */
  async fetchManualResult(eventid, match_id, game_type, market_type, selection_name, transaction = null) {
    try {
      const where = {
        eventid: String(eventid),
        match_id: String(match_id),
        game_type: String(game_type),
        market_type: String(market_type),
      };

      if (game_type === 'FAN') {
        if (marketsforfancyCheck.includes(market_type) && selection_name) {
          where.fancyName = selection_name;
        }
      }

      const manualRes = await this.models.MannualResult.findOne({
        where,
        order: [['created_at', 'DESC']],
        transaction: transaction || undefined,
        raw: true,
      });

      if (!manualRes) {
        this.logger?.info({ eventid, match_id, game_type, market_type }, '[Settlement] Manual result not found');
        return { declared: false, items: [] };
      }

      const item = {
        winnerName: manualRes.winnerName,
        winnerId: manualRes.winnerId,
        final_result: manualRes.winnerName,
      };

      return {
        declared: true,
        items: [item],
        meta: { source: 'manual', manual_result_id: manualRes.id },
      };
    } catch (e) {
      this.logger?.error({ eventid, error: e.message }, '[Settlement] fetchManualResult error');
      return { declared: false, items: [] };
    }
  }

  /** @legacy settlement.js `getMatchExposures` — exposure keyed by team/selection name. */
  async getMatchExposures(user_id, match_id, market_type) {
    try {
      const exposures = await this.models.UserExposures.findAll({
        attributes: ['team_name', 'exposure_amount'],
        where: {
          user_id: String(user_id),
          match_id: String(match_id),
          game_type: market_type,
        },
        raw: true,
      });

      const map = {};
      for (const r of exposures) {
        map[(r.team_name || '').toString()] = Number(r.exposure_amount || 0);
      }
      return map;
    } catch (e) {
      this.logger?.error({ user_id, match_id, error: e.message }, '[Settlement] getMatchExposures failed');
      return {};
    }
  }

  /** @legacy settlement.js `clearExposuresForMatch` */
  async clearExposuresForMatch(user_id, match_id, market_type, transaction = null) {
    try {
      await this.models.UserExposures.destroy({
        where: {
          user_id: String(user_id),
          match_id: String(match_id),
          game_type: market_type,
        },
        transaction: transaction || undefined,
      });
    } catch (e) {
      this.logger?.error({ user_id, match_id, error: e.message }, '[Settlement] clearExposuresForMatch failed');
      if (transaction) throw e;
    }
  }

  /**
   * @legacy settlement.js `closeBetsForMatch`
   *
   * Scoped by `job_id` as well as user+match, so a second market settled under
   * a different job is not closed by this one.
   */
  async closeBetsForMatch(user_id, match_id, onlyLine = false, resultStatus, job_id, transaction = null) {
    try {
      const where = {
        user_id: String(user_id),
        match_id: String(match_id),
        job_id: String(job_id),
        status: { [this.Op.in]: ['open', 'manual'] },
      };

      if (onlyLine) {
        where.bet_type = { [this.Op.in]: ['yes', 'no'] };
      }

      await this.models.SportsBet.update(
        { status: 'closed', result_status: resultStatus, updated_at: new Date() },
        { where, transaction: transaction || undefined }
      );
    } catch (e) {
      this.logger?.error({ user_id, match_id, error: e.message }, '[Settlement] closeBetsForMatch failed');
      if (transaction) throw e;
    }
  }

  /**
   * @legacy settlement.js `writeReport`
   *
   * `ON CONFLICT (bet_id) DO NOTHING` — one report row per bet, ever.
   * `bulkCreate([...], { ignoreDuplicates: true })` is Sequelize's name for
   * that statement. Failures are logged and swallowed, as in legacy: the audit
   * row must never be the reason a payout rolls back.
   */
  async writeReport(r, transaction = null) {
    try {
      await this.models.SportsSettlementReport.bulkCreate(
        [{
          job_id: r.job_id,
          bet_id: r.bet_id,
          user_id: String(r.user_id),
          eventid: String(r.eventid),
          match_id: r.match_id != null ? String(r.match_id) : null,
          game_type: r.game_type,
          market_type: r.market_type,
          fancy_name: r.fancy_name || null,
          selection_name: r.selection_name || null,
          user_selection_yn: r.user_selection_yn || null,
          resolved_winner: r.resolved_winner || null,
          resolved_team: r.resolved_team || null,
          actual_numeric: r.actual_numeric != null ? r.actual_numeric : null,
          rule_op: r.rule_op || null,
          rule_threshold: r.rule_threshold != null ? r.rule_threshold : null,
          credit_amount: Number(r.credit_amount || 0),
          exposures_map: r.exposures_map || {},
          api_snapshot: r.api_snapshot || {},
          decision_path: r.decision_path || [],
          created_at: new Date(),
        }],
        { ignoreDuplicates: true, transaction: transaction || undefined }
      );
    } catch (e) {
      this.logger?.error({ bet_id: r.bet_id, error: e.message }, '[Settlement] writeReport failed');
    }
  }

  /**
   * Add `amount` to a player's INR balance, reading the row first.
   *
   * @legacy settlement.js — the `SELECT inr FROM credits ... [FOR UPDATE]`
   * followed by `UPDATE credits SET inr = $1` that appears five times.
   * `lock` is passed where legacy said `FOR UPDATE` and omitted where it did
   * not, so the locking behaviour is unchanged per call site.
   */
  async #creditWallet(user_id, amount, { transaction = null, lock = false } = {}) {
    const record = await this.models.Credits.findOne({
      where: { uid: String(user_id) },
      transaction: transaction || undefined,
      ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    });

    if (!record) return { found: false, newBalance: null };

    const currentBal = Number(record.inr || 0);
    const newBal = currentBal + Number(amount);

    await this.models.Credits.update(
      { inr: newBal },
      { where: { uid: String(user_id) }, transaction: transaction || undefined }
    );

    return { found: true, newBalance: newBal };
  }

  /**
   * @legacy settlement.js — the four-column `UPDATE users SET net_win = ...`
   *
   * `gt` uses COALESCE because it is nullable and `NULL + x` is NULL; the other
   * three are NOT NULL. Kept as literals for exactly that reason — `increment()`
   * cannot express the COALESCE, and splitting the statement would let a crash
   * land between two halves of one player's totals. Every interpolated value
   * goes through `num()` first, so only finite numbers reach the SQL.
   */
  async #bumpUserTotals(user_id, { net_win, net_loss, total_profit, gt }, transaction = null) {
    const { literal } = this.db;

    await this.models.Users.update(
      {
        net_win: literal(`net_win + ${num(net_win)}`),
        net_loss: literal(`net_loss + ${num(net_loss)}`),
        total_profit: literal(`total_profit + ${num(total_profit)}`),
        gt: literal(`COALESCE(gt, 0) + ${num(gt)}`),
      },
      { where: { id: user_id }, transaction: transaction || undefined }
    );
  }

  /**
   * @legacy settlement.js `initiateRefund`
   *
   * A market the provider reports as SUSPENDED/CANCELLED: hand the stake back,
   * close the bet as `refund`, write the report. Note it refunds the STAKE, not
   * the held liability — a lay bet's blocked exposure is released separately by
   * `clearExposuresForMatch` at the call site.
   */
  async initiateRefund({ job_id, user_id, eventid, match_id, bet, market_type }, transaction = null) {
    const { id: bet_id, stake_amount } = bet;
    const stake = num(stake_amount);
    const desc = `Refund for SUSPENDED MO/BM bet; bet_id=${bet_id}; stake=${stake}`;
    const meta = { api: { type: 'result', eventid, match_id, status: 'suspended' }, bet_id };

    try {
      const { found, newBalance } = await this.#creditWallet(user_id, stake, { transaction });

      if (!found) {
        this.logger?.error({ bet_id, user_id }, '[Settlement] No wallet found for user');
        throw new Error(`No wallet found for user_id=${user_id}`);
      }

      await this.models.CreditsLedger.create({
        user_id: String(user_id),
        currency: 'INR',
        amount: stake,
        reason: 'refund',
        description: desc,
        eventid: String(eventid),
        job_id: String(job_id || ''),
        match_id: match_id ? String(match_id) : null,
        meta: meta || {},
        market_type,
      }, { transaction: transaction || undefined });

      this.logger?.info({ bet_id, user_id, credit: stake, balance: newBalance }, '[Settlement] Refund credited');

      await this.models.SportsBet.update(
        { status: 'closed', result_status: 'refund', updated_at: new Date() },
        {
          where: {
            id: bet_id,
            job_id: String(job_id),
            status: { [this.Op.in]: ['open', 'manual'] },
          },
          transaction: transaction || undefined,
        }
      );

      await this.writeReport({
        job_id,
        bet_id,
        user_id,
        eventid,
        match_id,
        game_type: String(bet.game_type || 'MO').toUpperCase(),
        market_type,
        selection_name: bet.selection_name,
        resolved_winner: null,
        resolved_team: null,
        credit_amount: stake,
        exposures_map: {},
        api_snapshot: { status: 'refund due to SUSPENDED' },
        decision_path: ['refund due to SUSPENDED status', desc],
      }, transaction);
    } catch (e) {
      this.logger?.error({ bet_id, user_id, error: e.message }, '[Settlement] Refund failed');

      await this.writeReport({
        job_id,
        bet_id,
        user_id,
        eventid,
        match_id,
        game_type: String(bet.game_type || 'MO').toUpperCase(),
        market_type,
        selection_name: bet.selection_name,
        resolved_winner: null,
        resolved_team: null,
        credit_amount: stake,
        exposures_map: {},
        api_snapshot: { status: 'refund failed SUSPENDED', bet_id, user_id, eventid, match_id },
        decision_path: ['[Settlement] Refund failed', { bet_id, user_id, error: e.message }],
      });

      throw e;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  MO / BM
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy settlement.js `processMobmGroup`
   *
   * All of one player's match-odds/bookmaker bets on one match, settled
   * together — they share a single exposure ledger, so the payout is derived
   * from the exposure map, not from summing per-bet winnings.
   *
   * `counts == 2` is a two-way market, anything else is three-way (the draw).
   * The branch tree below is the legacy one, unchanged.
   */
  async processMobmGroup({ job_id, user_id, eventid, match_id, bets, eventName, marketId, marketName, market_type, game_type, team_one, team_two, sport_id }) {
    this.logger?.info({ user_id, eventid, match_id, bets: bets.length }, '[Settlement] Processing MO/BM group');

    let result;
    const any = bets[0] || {};

    if (any.status == 'manual') {
      result = await this.fetchManualResult(eventid, match_id, game_type, market_type);
    } else {
      result = await this.results.fetchResultForEvent(eventid, eventName, marketId, marketName, sport_id, market_type);
    }

    if (!result.declared) {
      this.logger?.info({ user_id, match_id, eventid }, '[Settlement] MO/BM group not declared, requeue');
      return { settled: false, requeue: true };
    }

    const { winnerName, reason } = resolveMobmWinner({
      result,
      team_one,
      team_two,
      runners: runnerList(any),
      logger: this.logger,
    });

    this.logger?.info(
      { match_id, eventid, bets: bets.length },
      `[Settlement] MO/BM WINNER NAME or STATUS="${winnerName}" (${reason})`
    );

    // Check if winner is SUSPENDED
    if (winnerName.toUpperCase() === 'SUSPENDED') {
      this.logger?.info({ user_id, match_id, eventid }, '[Settlement] MO/BM group SUSPENDED, initiating refunds');

      for (const bet of bets) {
        // NB: legacy passes `game_type` into the `market_type` parameter here.
        // The ledger row's market_type therefore ends up null on this path.
        await this.initiateRefund({ job_id, user_id, eventid, match_id, bet, game_type });
      }

      // Clear exposures and mark job as done
      await this.clearExposuresForMatch(user_id, match_id, market_type);
      return { settled: true, requeue: false };
    }

    let totalCredit = 0;
    const exposuresMap = await this.getMatchExposures(user_id, match_id, market_type);

    const user = await this.models.Users.findOne({ where: { id: user_id }, raw: true });
    const userPercentage = user ? user.percentage : 2;

    for (const bet of bets) {
      let credit = moBmBetWinCredit(bet, winnerName, market_type);
      const stake = getStake(bet);
      const selIsWinner = namesMatch(bet.selection_name, winnerName);
      const oldExposures = await this.getMatchExposures(user_id, match_id, market_type);
      // Exposures are keyed by the name the bet was PLACED under (the runner name),
      // not by the short event-title name on the bet row — look up under both.
      const sides = sideAliases(bet);
      const team1 = findExposureValue(oldExposures, sides.one, 0);
      const team2 = findExposureValue(oldExposures, sides.two, 0);
      const draw = findExposureValue(oldExposures, ['The Draw', 'Draw', 'No Goal', 'Goal'], 0);
      const negExposures = Object.values(oldExposures).filter((x) => x < 0);
      const mostNeg = negExposures.length > 0 ? Math.min(...negExposures) : 0;

      let finalcredit = 0;
      if (bet.counts == 2) {
        if (matchesAny(sides.one, winnerName)) {
          if (team1 > 0 && team2 > 0) {
            finalcredit = team1;
          } else if (team1 < 0 && team2 < 0) {
            finalcredit = normalizeExposure(team2) - normalizeExposure(team1);
          } else if (team1 <= 0) {
            finalcredit = 0;
          } else {
            finalcredit = normalizeExposure(team1) + normalizeExposure(team2);
          }
        } else if (matchesAny(sides.two, winnerName)) {
          if (team1 > 0 && team2 > 0) {
            finalcredit = team2;
          } else if (team1 < 0 && team2 < 0) {
            finalcredit = normalizeExposure(team1) - normalizeExposure(team2);
          } else if (team2 <= 0) {
            finalcredit = 0;
          } else {
            finalcredit = normalizeExposure(team1) + normalizeExposure(team2);
          }
        } else if (winnerName === 'refund') {
          finalcredit = normalizeExposure(mostNeg);
        }
      } else {
        if (matchesAny(sides.one, winnerName)) {
          if (team1 > 0 && team2 > 0 && draw > 0) {
            finalcredit = team1;
          } else if (team1 < 0) {
            finalcredit = normalizeExposure(mostNeg) - normalizeExposure(team1);
          } else {
            finalcredit = normalizeExposure(mostNeg) + normalizeExposure(team1);
          }
        } else if (matchesAny(sides.two, winnerName)) {
          if (team1 > 0 && team2 > 0 && draw > 0) {
            finalcredit = team2;
          } else if (team2 < 0) {
            finalcredit = normalizeExposure(mostNeg) - normalizeExposure(team2);
          } else {
            finalcredit = normalizeExposure(mostNeg) + normalizeExposure(team2);
          }
        } else if (winnerName === 'refund') {
          finalcredit = normalizeExposure(mostNeg);
        } else {
          if (team1 > 0 && team2 > 0 && draw > 0) {
            finalcredit = draw;
          } else if (draw < 0) {
            finalcredit = normalizeExposure(mostNeg) - normalizeExposure(draw);
          } else {
            finalcredit = normalizeExposure(mostNeg) + normalizeExposure(draw);
          }
        }
      }

      totalCredit += credit;

      // Get odds information
      const rawOdds = getOdds(bet);
      const normalizedOddsValue = normalizeOdds(rawOdds);

      // Guard: a credit is always a finite, non-negative payout. A non-finite value
      // (e.g. NaN from a missing exposure) used to leak into the ledger as `credit=NaN`;
      // the wallet was protected by num() but the description/row was not. Clamp here so
      // the row, the description and the wallet all agree.
      finalcredit = Math.max(0, num(finalcredit));

      const desc = `MO/BM per-bet; winner="${winnerName}"; bet_type=${bet.bet_type}; selection="${bet.selection_name}"; odds=${rawOdds}; normalized_odds=${normalizedOddsValue}; stake=${stake}; credit=${finalcredit}`;
      const meta = { api: { type: 'result', eventid, marketId, marketName, status: result.declared }, winnerName, reason, bet_id: bet.id, odds: rawOdds, normalized_odds: normalizedOddsValue };

      if (bet.fixed == 0) {
        const totalbets = await this.models.SportsBet.count({
          where: { eventid, match_id, game_type: 'MO', user_id },
        });

        let drawex = bet.counts == 3 ? draw : 0;

        await this.models.Marketwins.create({
          totalbets,
          matchid: match_id,
          eventid,
          team1ex: team1,
          team2ex: team2,
          drawex,
          winteam: winnerName,
          matchname: `${bet.team_one} vs ${bet.team_two}`,
          payout: finalcredit,
          user_id,
          created_at: new Date(),
        });
      }

      if (bet.fixed == 1) {
        finalcredit = 0;
      }

      // Calculate cost (liability/stake) for stats
      let cost = 0;
      if (isBack(bet) || bet.bet_type === 'Yes' || bet.bet_type === 'yes') {
        cost = stake;
      } else if (isLay(bet) || bet.bet_type === 'No' || bet.bet_type === 'no') {
        cost = (rawOdds - 1) * stake;
      }
      cost = cost > 0 ? cost : 0;

      if (finalcredit !== 0 || this.LEDGER_ZERO_ROWS) {
        const creditAmount = finalcredit;
        const amt = num(creditAmount);
        try {
          const { found } = await this.#creditWallet(user_id, amt);
          if (!found) this.logger?.error({ user_id }, '[Settlement] No credit record for user');
        } catch (err) {
          this.logger?.error({ user_id, error: err.message }, '[Settlement] Error updating credit record');
        }
      }

      let profit = 0;
      let loss = 0;
      let netamount = 0;

      if (totalCredit > 0) {
        profit = totalCredit;
        netamount = totalCredit;
      } else {
        if (isBack(bet) || bet.bet_type === 'Yes' || bet.bet_type === 'yes') {
          loss = -stake;
          netamount = -stake;
        } else if (isLay(bet) || bet.bet_type === 'No' || bet.bet_type === 'no') {
          loss = -bet.liability;
          netamount = -bet.liability;
        }
      }
      // Guard: liability can be null/undefined for some lay/no bets, which would make
      // netamount NaN. That column is summed by the balance sheet and added to
      // users.total_profit / staff_balances — a single NaN breaks the whole ledger total.
      // Keep all three finite (0 floor) so a missing-liability data gap never propagates.
      profit = num(profit);
      loss = num(loss);
      netamount = num(netamount);

      await this.#bumpUserTotals(user_id, {
        net_win: profit,
        net_loss: loss,
        total_profit: netamount,
        gt: netamount,
      });

      const Usersdata = await this.models.Users.findOne({ where: { id: user_id }, raw: true });
      let closing = Usersdata.total_profit;

      try {
        await this.models.CreditsLedger.create({
          user_id,
          currency: 'INR',
          amount: totalCredit,
          reason: 'test',
          description: desc || null,
          eventid: eventid || null,
          match_id: match_id || null,
          job_id: job_id || null,
          market_type: market_type || null,
          sport_id: bet.sport_id || null,
          meta: meta || null,
          commission: null,
          netamount: netamount || null,
          profit: profit || 0,
          loss: loss || null,
          bet_id: bet.id || null,
          closing: closing || null,
        });
      } catch (err) {
        this.logger?.error({ err }, '[Settlement] CreditsLedger create failed');
        throw err;
      }

      await this.writeReport({
        job_id, bet_id: bet.id, user_id, eventid, match_id,
        game_type: String(bet.game_type || 'MO').toUpperCase(),
        market_type, selection_name: bet.selection_name,
        resolved_winner: winnerName || null, resolved_team: winnerName || null,
        credit_amount: finalcredit, exposures_map: exposuresMap,
        api_snapshot: result.meta, decision_path: [reason, desc],
      });
    }

    const resultStatus = totalCredit > 0 ? 'won' : 'loss';

    await this.models.SportsBet.update(
      { fixed: 1, updated_at: new Date() },
      { where: { match_id, user_id, game_type, market_type } }
    );

    await this.closeBetsForMatch(user_id, match_id, false, resultStatus, job_id);
    await this.clearExposuresForMatch(user_id, match_id, market_type);
    return { settled: true, requeue: false };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  FAN bets that are really two-outcome side markets
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy settlement.js `processnonfancy`
   *
   * Soccer/tennis over-under, period winners and friends: filed under game_type
   * FAN, but priced and exposed like a normal back/lay market. `isNonFancyMarket`
   * routes them here.
   */
  async processnonfancy({ job_id, user_id, eventid, match_id, bet, eventName, marketId, marketName, market_type, game_type, team_one, team_two, result }) {
    const { winnerName, reason } = resolveFanWinner({ result, runners: runnerList(bet) });

    this.logger?.info(
      { match_id, eventid, marketId, marketName },
      `[Settlement] FAN/non-FAN WINNER NAME or STATUS="${winnerName}" (${reason})`
    );

    // Check if winner is SUSPENDED
    if (winnerName.toUpperCase() === 'SUSPENDED') {
      this.logger?.info({ user_id, match_id, eventid }, '[Settlement] MO/BM group SUSPENDED, initiating refunds');

      await this.db.transaction(async (transaction) => {
        await this.initiateRefund({ job_id, user_id, eventid, match_id, bet, game_type }, transaction);
        await this.clearExposuresForMatch(user_id, match_id, market_type, transaction);
      });

      return { settled: true, requeue: false };
    }

    // ---- Read-only calculations (outside transaction) ----
    let totalCredit = 0;
    const exposuresMap = await this.getMatchExposures(user_id, match_id, market_type);

    const user = await this.models.Users.findOne({ where: { id: user_id }, raw: true });
    const userPercentage = user ? user.percentage : 2;

    let credit = moBmBetWinCredit(bet, winnerName, market_type);
    const stake = getStake(bet);
    const selIsWinner = namesMatch(bet.selection_name, winnerName);
    const oldExposures = await this.getMatchExposures(user_id, match_id, market_type);
    // FAN (soccer over/under, etc.) bets are single-selection yes/no/back/lay bets.
    // At placement the worst-case liability was blocked from the wallet and stored
    // as the negative exposure on the bet's OWN selection key (`sel`). At settlement
    // we release that block and add the winnings on a win — on a loss the block is
    // forfeited, so nothing is returned.
    //
    // We must NOT use calculateFinalCredit() here: it looks the *winner name* up in
    // the exposure map, but fancy exposures are keyed by the bet's selection
    // (sel / sel+'back' / sel+'lay'), never the API winner name. That made a losing
    // bet fall through to |mostNeg| and get wrongly refunded its full stake (live
    // wallet ended above the ledger), and made a winning bet match the negative
    // `sel` value and get paid 0. Derive the credit from the bet's own outcome
    // instead — `credit` is the per-bet winnings (>0 only when this bet won).
    const selExposure = findExposureValue(oldExposures, bet.selection_name, 0);
    const blockedLiability = selExposure < 0 ? Math.abs(selExposure) : 0;
    let finalcredit = credit > 0 ? blockedLiability + credit : 0;

    totalCredit += credit;

    // Get odds information
    const rawOdds = getOdds(bet);
    const normalizedOddsValue = normalizeOdds(rawOdds);

    finalcredit = Math.max(0, num(finalcredit));

    const desc = `FAN per-bet; winner="${winnerName}"; bet_type=${bet.bet_type}; selection="${bet.selection_name}"; odds=${rawOdds}; normalized_odds=${normalizedOddsValue}; stake=${stake}; credit=${finalcredit}`;
    const meta = { api: { type: 'result', eventid, marketId, marketName, status: result.declared }, winnerName, reason, bet_id: bet.id, odds: rawOdds, normalized_odds: normalizedOddsValue };

    if (bet.fixed == 1) {
      finalcredit = 0;
    }

    // Calculate cost (liability/stake) for stats
    let cost = 0;
    if (isBack(bet)) {
      cost = stake;
    } else if (isLay(bet)) {
      cost = (rawOdds - 1) * stake;
    }
    cost = cost > 0 ? cost : 0;

    let profit = 0;
    let loss = 0;
    let netamount = 0;

    if (totalCredit > 0) {
      profit = totalCredit;
      netamount = totalCredit;
    } else {
      if (isBack(bet) || bet.bet_type === 'Yes' || bet.bet_type === 'yes') {
        loss = -stake;
        netamount = -stake;
      } else if (isLay(bet) || bet.bet_type === 'No' || bet.bet_type === 'no') {
        loss = -bet.liability;
        netamount = -bet.liability;
      }
    }
    profit = num(profit);
    loss = num(loss);
    netamount = num(netamount);

    // ---- All DB writes inside a single transaction ----
    await this.db.transaction(async (transaction) => {
      /* WALLET LOCK + UPDATE */
      if (finalcredit !== 0 || this.LEDGER_ZERO_ROWS) {
        const amt = num(finalcredit);
        const { found } = await this.#creditWallet(user_id, amt, { transaction, lock: true });
        if (!found) this.logger?.error({ user_id }, '[Settlement] No credit record for user');
      }

      /* USER PROFIT / LOSS */
      await this.#bumpUserTotals(user_id, {
        net_win: profit,
        net_loss: loss,
        total_profit: netamount,
        gt: netamount,
      }, transaction);

      /* FETCH USER */
      const Usersdata = await this.models.Users.findOne({
        attributes: ['profit', 'parent_staff_id', 'total_profit'],
        where: { id: user_id },
        transaction,
        raw: true,
      });

      let closing = Usersdata?.total_profit;

      /* STAFF UPLINE */
      if (Usersdata?.parent_staff_id) {
        await this.updateStaffParentBalUp(Usersdata.parent_staff_id, netamount, transaction);
      }

      /* CREDITS LEDGER */
      await this.models.CreditsLedger.create({
        user_id,
        currency: 'INR',
        amount: totalCredit,
        reason: 'test',
        description: desc || null,
        eventid: eventid || null,
        match_id: match_id || null,
        job_id: job_id || null,
        market_type: market_type || null,
        sport_id: bet.sport_id || null,
        meta: meta || {},
        commission: null,
        netamount: netamount || null,
        profit: profit || 0,
        loss: loss || null,
        bet_id: bet.id || null,
        closing: closing || null,
      }, { transaction });

      /* REPORT */
      await this.writeReport({
        job_id,
        bet_id: bet.id,
        user_id,
        eventid,
        match_id,
        game_type: String(bet.game_type || 'MO').toUpperCase(),
        market_type,
        selection_name: bet.selection_name,
        resolved_winner: winnerName || null,
        resolved_team: winnerName || null,
        credit_amount: finalcredit,
        exposures_map: exposuresMap,
        api_snapshot: result.meta,
        decision_path: [reason, desc],
      }, transaction);

      /* MARK BETS FIXED */
      const resultStatus = totalCredit > 0 ? 'won' : 'loss';

      await this.models.SportsBet.update(
        { fixed: 1, updated_at: new Date() },
        { where: { match_id, user_id, game_type, market_type }, transaction }
      );

      await this.closeBetsForMatch(user_id, match_id, false, resultStatus, job_id, transaction);
      await this.clearExposuresForMatch(user_id, match_id, market_type, transaction);
    });

    return { settled: true, requeue: false };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Fancy sessions
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy settlement.js `processFanBet`
   *
   * One fancy bet. Two payout formulas, chosen by market type:
   *
   *   odds-priced   (ODDS_PRICED_FANCY_MARKETS)  yes wins stake*(odds-1), no wins stake
   *   size-priced   (everything else — sessions) yes wins stake*(size/100), no wins stake
   *
   * and, unlike MO/BM, the wallet is moved TWICE: once to release the blocked
   * exposure on the selection, once by the signed `netamount`.
   */
  async processFanBet({ job_id, bet, eventName, marketId, marketName }) {
    const {
      id: bet_id, user_id, eventid, match_id, fancy_name, selection_name, bet_type, game_type,
      odds, stake_amount, market_type, team_one, team_two, runners, size, sport_id, status,
    } = bet;

    this.logger?.info(
      { bet_id, user_id, eventid, fancy_name, match_id, bet_type, sport_id, market_type, status },
      '[Settlement] Processing FAN bet'
    );

    let result;
    if (status === 'manual') {
      // For FAN bets, we pass selection_name as the session identifier for the manual table lookup
      result = await this.fetchManualResult(eventid, match_id, game_type, market_type, selection_name);
    } else {
      result = await this.results.fetchResultForEventFancy(eventid, eventName, marketId, selection_name, sport_id, market_type);
    }

    const user = await this.models.Users.findOne({ where: { id: user_id }, raw: true });
    const userPercentage = user ? user.percentage : 2;

    const exposuresMap = await this.getMatchExposures(user_id, match_id, market_type);

    if (!result.declared) {
      this.logger?.info({ bet_id, user_id, eventid }, '[Settlement] FAN bet not declared, requeue');
      return { settled: false, requeue: true };
    }

    if (isNonFancyMarket(market_type)) {
      return await this.processnonfancy({
        job_id, user_id, eventid, match_id, bet, eventName, marketId, marketName,
        market_type, game_type, team_one, team_two, result,
      });
    }

    const resolve = resolveFancyWinner({
      result: result.items[0], fancy_name, selection_name, team_one, team_two,
      bet_type, market_type, odds, logger: this.logger,
    });

    let credit = 0;
    let winner = false;
    let netamount = 0;
    let resolved_winner = null;
    let desc = null;
    let meta = null;
    const decision_path = [resolve?.reason];

    if (resolve?.type === 'suspended') {
      await this.initiateRefund({ job_id, user_id, eventid, match_id, bet, market_type });
      await this.clearExposuresForMatch(user_id, match_id, market_type);
      return { settled: true, requeue: false };
    } else if (resolve?.type === 'string') {
      winner = resolve.winnerName === 'won';

      if (ODDS_PRICED_FANCY_MARKETS.has(market_type)) {
        // fancy
        if (winner) {
          credit = bet_type === 'yes' || bet_type === 'YES' ? stake_amount * (odds - 1) : stake_amount;
          netamount = bet_type === 'yes' || bet_type === 'YES' ? stake_amount * (odds - 1) : stake_amount;
        } else {
          credit = 0;
          netamount = bet_type === 'yes' || bet_type === 'YES' ? -stake_amount : -stake_amount * (odds - 1);
        }
      } else {
        // normal
        if (winner) {
          credit = bet_type === 'yes' || bet_type === 'YES' ? stake_amount * (bet.size / 100) : stake_amount;
          netamount = bet_type === 'yes' || bet_type === 'YES' ? stake_amount * (bet.size / 100) : stake_amount;
        } else {
          credit = 0;
          netamount = bet_type === 'yes' || bet_type === 'YES' ? -stake_amount : -stake_amount * (bet.size / 100);
        }
      }
      resolved_winner = winner ? selection_name : null;
      decision_path.push(`string match: selection=${selection_name} winnerName=${resolve.winnerName}`);
    } else {
      this.logger?.info({ bet_id, type: resolve?.type }, '[Settlement] Unknown resolve type for FAN bet, requeue');
      return { settled: false, requeue: true };
    }

    await this.db.transaction(async (transaction) => {
      /* GET OLD EXPOSURE */
      const oldExposureRow = await this.models.UserExposures.findOne({
        attributes: ['id', 'exposure_amount'],
        where: {
          user_id,
          match_id,
          game_type: market_type,
          team_name: selection_name,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      const oldExposure = oldExposureRow ? Number(oldExposureRow.exposure_amount) : 0;

      let releaseexposure = Math.abs(oldExposure);

      /* RELEASE EXPOSURE TO WALLET */
      if (releaseexposure > 0) {
        await this.#creditWallet(user_id, releaseexposure, { transaction, lock: true });
      }

      /* FAN WIN RECORD */
      await this.models.Fanwins.create({
        userid: user_id,
        fancyname: fancy_name,
        selection: selection_name,
        runsodds: odds,
        payout: credit,
        eventid,
        matchid: match_id,
        created_at: new Date(),
      }, { transaction });

      /* WALLET CREDIT / DEBIT */
      if (Number(netamount) !== 0) {
        const { found } = await this.#creditWallet(user_id, Number(netamount), { transaction, lock: true });
        if (!found) throw new Error('Wallet not found');
      }

      /* DELETE USER EXPOSURES */
      await this.models.UserExposures.destroy({
        where: {
          user_id,
          match_id,
          game_type: market_type,
          team_name: {
            [this.Op.in]: [selection_name, `${selection_name}lay`, `${selection_name}back`],
          },
        },
        transaction,
      });

      /* UPDATE USER PROFIT / LOSS */
      await this.#bumpUserTotals(user_id, {
        net_win: winner ? netamount : 0,
        net_loss: winner ? 0 : netamount,
        total_profit: netamount,
        gt: netamount,
      }, transaction);

      /* FETCH USER DATA */
      const Usersdata = await this.models.Users.findOne({
        attributes: ['profit', 'parent_staff_id', 'total_profit'],
        where: { id: user_id },
        transaction,
        raw: true,
      });

      const closing = Usersdata.total_profit;

      /* UPDATE STAFF UPLINE */
      if (Usersdata.parent_staff_id) {
        await this.updateStaffParentBalUp(Usersdata.parent_staff_id, netamount, transaction);
      }

      /* CREDIT LEDGER */
      await this.models.CreditsLedger.create({
        user_id,
        currency: 'INR',
        amount: credit,
        reason: 'test',
        description: null,
        eventid,
        match_id,
        job_id,
        market_type,
        sport_id: bet.sport_id,
        meta: result.meta,
        commission: null,
        netamount,
        profit: winner ? netamount : null,
        loss: winner ? null : netamount,
        bet_id: bet.id,
        closing,
      }, { transaction });

      /* CLOSE BET */
      const resultStatus = winner ? 'won' : 'loss';

      await this.models.SportsBet.update(
        { status: 'closed', result_status: resultStatus, updated_at: new Date() },
        {
          where: {
            id: bet_id,
            job_id: String(job_id),
            status: { [this.Op.in]: ['open', 'manual'] },
          },
          transaction,
        }
      );
    });

    return { settled: true, requeue: false };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Job processing
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy settlement.js `processJob`
   *
   * MO/BM bets group by user+match; FAN bets settle individually. If ANY group
   * requeues or throws, the whole job goes back to `queued` — including the
   * groups that already settled, which is why every write path is guarded
   * against re-running against an already-closed bet (`status IN ('open','manual')`
   * on every UPDATE).
   */
  async processJob(job) {
    const { job_id, user_id, eventid } = job;
    this.logger?.info({ job_id }, `[Settlement] Processing job job_id=${job_id} user=${user_id} event=${eventid}`);

    const bets = await this.models.SportsBet.findAll({
      where: {
        job_id: String(job_id),
        status: { [this.Op.in]: ['open', 'manual'] },
      },
      order: [['created_at', 'ASC']],
      raw: true,
    });

    if (!bets.length) {
      this.logger?.info({ job_id }, `[Settlement] No open bets for job_id=${job_id}; marking done`);

      await this.models.SportsEventSettlementJobs.update(
        { status: 'done', updated_at: new Date(), error_msg: null },
        { where: { job_id: String(job_id) } }
      );
      return;
    }

    const moBmByMatch = new Map();
    const fanBets = [];
    for (const b of bets) {
      const gt = (b?.game_type).toUpperCase();
      if (gt === 'MO' || gt === 'BM' || gt === 'BO') {
        const k = `${b.user_id}::${b.match_id}`;
        if (!moBmByMatch.has(k)) moBmByMatch.set(k, []);
        moBmByMatch.get(k).push(b);
      } else if (gt === 'FAN') {
        fanBets.push(b);
      } else {
        this.logger?.error({ bet_id: b.id }, `[Settlement] Unknown game_type="${b.game_type}"`);
      }
    }

    let anyRequeue = false;
    for (const [, group] of moBmByMatch.entries()) {
      const any = group[0];
      try {
        const res = await this.processMobmGroup({
          job_id, user_id: any.user_id, eventid: any.eventid, match_id: any.match_id, bets: group,
          eventName: any.match_title || '', marketId: any.match_id, marketName: any.selection_name || '',
          market_type: any.market_type, game_type: any.game_type, team_one: any.team_one, team_two: any.team_two,
          sport_id: any.sport_id,
        });
        if (res.requeue) anyRequeue = true;
      } catch (e) {
        anyRequeue = true;
        this.logger?.error({ match_id: any.match_id, error: e.message }, '[Settlement] MO/BM group failed');
      }
    }

    for (const b of fanBets) {
      try {
        const res = await this.processFanBet({
          job_id, bet: b, eventName: b.match_title || '', marketId: b.match_id, marketName: b.fancy_name || '',
        });
        if (res.requeue) anyRequeue = true;
      } catch (e) {
        anyRequeue = true;
        this.logger?.error({ bet_id: b.id, error: e.message }, '[Settlement] FAN bet failed');
      }
    }

    await this.models.SportsEventSettlementJobs.update(
      { status: anyRequeue ? 'queued' : 'done', updated_at: new Date(), error_msg: null },
      { where: { job_id: String(job_id) } }
    );

    this.logger?.info(
      { job_id },
      anyRequeue ? `[Settlement] job_id=${job_id} kept queued for next tick` : `[Settlement] job_id=${job_id} DONE`
    );
  }

  /**
   * @legacy settlement.js `pollOnce`
   *
   * Pick queued jobs, plus jobs stranded in 'processing' (e.g. by a worker
   * crash/restart mid-run) longer than STALE_PROCESSING_MIN minutes so they are
   * never orphaned.
   */
  async pollOnce() {
    this.logger?.info('[Settlement] ===== Poll start =====');

    try {
      const staleCutoff = () => new Date(Date.now() - this.STALE_PROCESSING_MIN * 60 * 1000);

      const rows = await this.models.SportsEventSettlementJobs.findAll({
        attributes: ['job_id', 'user_id', 'eventid', 'payload'],
        where: {
          [this.Op.or]: [
            { status: 'queued' },
            { status: 'processing', updated_at: { [this.Op.lt]: staleCutoff() } },
          ],
        },
        order: [['created_at', 'ASC']],
        limit: this.BATCH_LIMIT,
        raw: true,
      });

      this.logger?.info({ job_count: rows.length }, `[Settlement] Picked ${rows.length} job(s) (queued + stale-processing)`);

      for (const job of rows) {
        try {
          // Claim the job: accept either a 'queued' job or one stranded in
          // 'processing' past the stale threshold (recovery after a crash).
          const [claimed] = await this.models.SportsEventSettlementJobs.update(
            { status: 'processing', updated_at: new Date() },
            {
              where: {
                job_id: job.job_id,
                [this.Op.or]: [
                  { status: 'queued' },
                  { status: 'processing', updated_at: { [this.Op.lt]: staleCutoff() } },
                ],
              },
            }
          );

          // Legacy wrote `if (updatedCount[0] === 0)` against a plain row count,
          // so the guard never fired and a job another worker had already
          // claimed was processed anyway. With one worker that is invisible;
          // with two it is a double payout. Checked properly here — for a single
          // worker the claim always succeeds, so nothing else changes.
          if (claimed === 0) {
            this.logger?.debug({ job_id: job.job_id }, '[Settlement] Job already taken');
            continue;
          }

          const user_id = job?.user_id;
          const eventid = job?.eventid;
          if (!user_id || !eventid) {
            this.logger?.error({ job_id: job.job_id }, '[Settlement] Job missing userId/eventId');
            await this.models.SportsEventSettlementJobs.update(
              { status: 'failed', error_msg: 'Missing userId/eventId', updated_at: new Date() },
              { where: { job_id: job.job_id } }
            );
            continue;
          }

          await this.processJob(job);
        } catch (e) {
          this.logger?.error({ job_id: job.job_id, user_id: job.user_id, error: e.message }, '[Settlement] Job failed');

          await this.models.SportsEventSettlementJobs.update(
            { status: 'failed', error_msg: e.message, updated_at: new Date() },
            { where: { job_id: job.job_id } }
          );
        }
      }

      const [stats] = await this.db.sequelize.query(
        `SELECT
           COUNT(*) FILTER (WHERE status='queued')     AS queued,
           COUNT(*) FILTER (WHERE status='processing') AS processing,
           COUNT(*) FILTER (WHERE status='done')       AS done,
           COUNT(*) FILTER (WHERE status='failed')     AS failed
         FROM sports_event_settlement_jobs`,
        { type: this.db.QueryTypes.SELECT }
      );

      this.logger?.info(
        `[Settlement] queue stats => queued:${stats.queued || 0} processing:${stats.processing || 0} done:${stats.done || 0} failed:${stats.failed || 0}`
      );
    } catch (e) {
      this.logger?.error({ error: e.message }, '[Settlement] pollOnce failed');
    } finally {
      this.logger?.info('[Settlement] ===== Poll end =====');
    }
  }
}

/** The worker entry point — `worker.js` calls this on the job's interval. */
function createPayoutJob(container) {
  const runner = new PayoutRunner(container);
  return () => runner.pollOnce();
}

module.exports = { createPayoutJob, PayoutRunner };
