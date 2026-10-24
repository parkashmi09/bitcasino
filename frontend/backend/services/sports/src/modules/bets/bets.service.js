'use strict';

const { fn, col, literal, Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const { BET_STATUS, REFUNDED_RESULTS } = require('./bets.constants');
const { worstCase } = require('./exposure');
const { verifyBetAgainstLiveOdds } = require('./legacy/oddsGuard');
const { getMarketNameFromGtype } = require('./legacy/marketName');
const {
  normalizeOdds,
  marketsfornonfancy,
  isNonFancyMarket,
  marketsforfancy,
  marketsforBMfancy,
  marketforfancywithbigrunners,
  calculateRunnerExposure,
  isFancyMatch,
  OVERS_LINE_MARKETS,
} = require('./legacy/markets');

/**
 * Placing a sports bet.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS `legacy/sportsmain/API/controller.js` → `placeBet`, PORTED VERBATIM
 *
 * That handler — `POST /api/sportsmain/place-bet`, controller.js:117-2107 — is
 * the only one of the three legacy implementations that has ever placed a bet,
 * and it is the one the live board still posts to. It is copied here step for
 * step: the same destructure, the same order of checks, the same market tables,
 * the same float arithmetic, the same liability and balance-change rules, the
 * same columns on the insert, and the same response body.
 *
 * WHAT CHANGED, AND ONLY THIS:
 *
 *   1. Every `pg.query(...)` is the equivalent Sequelize model call.
 *      `BEGIN`/`COMMIT`/`ROLLBACK` on the one shared `pg.Client` become a real
 *      per-request transaction — legacy's `BEGIN` opened a transaction on the
 *      single connection the whole process shares, so concurrent requests
 *      interleaved into one transaction and any `ROLLBACK` discarded another
 *      request's writes.
 *
 *   2. `user_id` is the AUTHENTICATED player, not a body field. Legacy read it
 *      from the request on an unauthenticated route, so anybody could place a
 *      bet against anybody's wallet. The body may still carry `user_id`; it is
 *      ignored. Nothing else about the payload changed.
 *
 *   3. The staff bet-lock walk is one call to admin-service rather than a loop
 *      over `staff`. The `staff` tables belong to admin-service and are not
 *      registered on this connection; `betLockState` there does exactly what
 *      legacy's `while (_staffId)` loop did — the account plus every ancestor.
 *
 *   4. An advisory lock on (player, match) wraps the calculation. Legacy relied
 *      on `SELECT ... FOR UPDATE` over `user_exposures`, which locks nothing
 *      when there are no rows yet, so the first two bets on a match raced. The
 *      `FOR UPDATE` reads are still here; the lock only closes that gap and
 *      changes no computed value.
 *
 * Everything the port carries across UNCHANGED, including the parts that are
 * plainly wrong, because the instruction was to copy it exactly:
 *
 *   - `category + "1"` on the insert — string concatenation, so a payload
 *     `category: "0"` is written as `"01"` (controller.js:1935).
 *   - `count = runners?.length` overwrites whatever the body sent, then
 *     `count == 3` decides whether the Draw leg is calculated at all.
 *   - the odds are the caller's. `verifyBetAgainstLiveOdds` checks them against
 *     the cached book, which is the only thing standing between a body field
 *     and a payout — if `oddsData:<gmid>` is cold the bet is refused, and if
 *     `BET_GUARD_ALLOW_ON_MISS=true` it is not checked at all.
 *   - IEEE-754 floats throughout the exposure and balance maths.
 * ═════════════════════════════════════════════════════════════════════════
 */
class BetsService {
  constructor({ models, db, cache, wallet, feed, logger, config, clients }) {
    this.models = models;
    this.db = db;
    this.cache = cache;
    this.wallet = wallet;
    this.feed = feed;
    this.logger = logger;
    this.config = config;
    this.clients = clients;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Placing
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/sportsmain/place-bet — controller.js:117-2107
   *
   * Answers the way legacy's handler did, so the caller sees the same thing:
   *
   *   `{ status, body }` for the paths legacy `return`ed from directly (the
   *   two lock refusals and the odds guard), and a THROW for the paths it let
   *   fall into its catch, which answered `400 {success:false, message}`.
   *
   * @param {object} body the request body, plus `user_id` (from the token) and
   *   `ip_address` (from the proxy chain) — see `controllers/index.js`.
   */
  async place(body) {
    /* eslint-disable camelcase */
    let {
      game_type, match_id, match_title, selection_name, bet_type, odds, stake_amount, team_one, team_two, category, original_currency,
      original_amount, usd_amount, match_start_time, eventid, fancy_name, count, sid, market_type, unmatched, unmatched_odds, size, runners,
      lay_size, back_size, runner_odds, mname, gtype, nat, section,
      event_name, user_id, market_id, selection_id, ip_address,
    } = body;

    const { Users, Credits, UserExposures, SportsBet } = this.models;

    count = runners?.length;

    //=============================================================================================
    // ✅ STEP 2:                 COMMON VALIDATIONS
    //=============================================================================================

    // ✅ Sports Bet Lock Check (user + staff upline hierarchy)
    const userLock = await Users.findByPk(user_id, {
      attributes: ['id', 'sports_betlocked', 'parent_staff_id'],
      raw: true,
    });
    if (!userLock) {
      return { status: 400, body: { success: false, message: 'User not found' } };
    }
    if (userLock.sports_betlocked) {
      return { status: 403, body: { success: false, message: 'Betting is locked for your account.' } };
    }
    /**
     * The staff upline chain.
     *
     * Legacy walked `staff` row by row from `parent_staff_id` up through
     * `parent_id`. `staff` is admin-owned and not on this connection, so this
     * is the internal endpoint that performs the same walk — the account's own
     * flag first, then every ancestor in `staff_hierarchy`.
     *
     * It fails CLOSED. An unreachable admin-service must not become a way to
     * bet from a locked hierarchy.
     */
    if (userLock.parent_staff_id) {
      let answer;
      try {
        answer = await this.clients.admin.get(
          `/internal/admin/staff-directory/staff/${userLock.parent_staff_id}/betlock`
        );
      } catch (error) {
        this.logger?.error({ err: error, user_id }, 'Could not check the staff bet lock — refusing the bet');
        return { status: 403, body: { success: false, message: 'Betting is locked by your upline.' } };
      }
      if (answer?.data?.locked) {
        return { status: 403, body: { success: false, message: 'Betting is locked by your upline.' } };
      }
    }

    // ✅ Live odds guard — the client-side check in BetSlip is advisory only.
    // Re-verify against the cached feed (oddsData:<gmid>, refreshed every 2s)
    // that the market is open and the submitted price is still the live one.
    const guard = await verifyBetAgainstLiveOdds(
      {
        gmid: eventid,
        market_id,
        mname,
        gtype,
        selection_sid: selection_id,
        selection_name: selection_name || nat,
        bet_type,
        odds,
        // fancy run line: `size` is only resolved from back_size/lay_size further down
        size: size || (['lay', 'no'].includes(String(bet_type || '').toLowerCase()) ? lay_size : back_size),
        // an unmatched bet is deliberately priced away from the live book
        allowWorseOdds: !!unmatched,
      },
      { cache: this.cache, logger: this.logger }
    );

    if (!guard.ok) {
      this.logger?.warn(
        {
          user_id, eventid, market_id, selection_name, bet_type, odds,
          code: guard.code, liveOdds: guard.liveOdds,
        },
        '[betGuard] rejected'
      );
      return { status: 403, body: { success: false, code: guard.code, message: guard.message } };
    }

    this.logger?.debug({ live: guard.live }, '[betGuard] passed');

    //=============================================================================================
    // ✅ STEP 4: the market name legacy derived before placing (inert — see marketName.js)
    //=============================================================================================

    getMarketNameFromGtype({ mname, gtype, nat, section });

    //=============================================================================================
    // ✅ STEP 5:                   EXPOSURE CALCULATION & WALLET VALIDATION
    //=============================================================================================

    const stake = Number(stake_amount);
    const oddN = Number(odds);
    const betTypeLower = (bet_type || '').toLowerCase().trim();
    if (game_type === 'BOOKMAKER') {
      game_type = 'BM';
    }
    if (game_type === 'FANCY') {
      game_type = 'FAN';
    }

    const isYesNo = betTypeLower === 'yes' || betTypeLower === 'no';
    const isFancy = game_type === 'FAN' || (game_type === 'MO' && isYesNo);

    // Validation
    if (stake <= 0) throw new Error('Invalid stake');
    if (isFancy) {
      if (!Number.isFinite(oddN) || oddN <= 0) throw new Error('Invalid fancy odds');
      // if (!isYesNo) throw new Error("Fancy bet must be YES or NO");
    } else {
      if (!Number.isFinite(oddN) || oddN <= 1) throw new Error('Invalid odds');
    }

    if (lay_size && back_size) {
      const bt = (bet_type || '').toLowerCase();
      size = (bt === 'lay' || bt === 'no') ? lay_size : back_size;
    }

    const exposureGameType = market_type;

    const sel = (selection_name || '').toString();
    const selLower = sel.trim().toLowerCase();
    const isDrawSel = selLower === 'the draw' || selLower === 'draw';
    const normGameType = isFancy ? 'FAN' : game_type === 'BM' ? 'BM' : 'MO';

    /**
     * One transaction for the whole money path, and an advisory lock on
     * (player, match) around it.
     *
     * Legacy's `BEGIN` went to the single shared `pg.Client`, so it was not
     * this request's transaction at all. This one is.
     */
    return this.db.transaction(async (transaction) => {
      const { result } = await this.db.advisoryLock(
        `sports-bet:${user_id}:${match_id}`,
        async () => {
          // ── Wallet ────────────────────────────────────────────────────
          // @legacy SELECT * FROM credits WHERE uid = $1 FOR UPDATE
          const wallet = await Credits.findOne({
            where: { uid: String(user_id) },
            lock: transaction.LOCK.UPDATE,
            transaction,
            raw: true,
          });

          if (!wallet) throw new Error('Wallet not found');
          const currentInr = Number(wallet.inr);

          // ── Exposures ─────────────────────────────────────────────────
          // @legacy SELECT * FROM user_exposures
          //           WHERE user_id=$1 AND match_id=$2 AND game_type=$3 FOR UPDATE
          const oldExposuresRows = await UserExposures.findAll({
            where: {
              user_id: String(user_id),
              match_id: String(match_id),
              // `?? null` because Sequelize REFUSES an undefined in a where
              // clause, where legacy's `game_type = $3` with an undefined
              // parameter simply matched nothing. A body without
              // `market_type` reaches the same empty position instead of
              // throwing a driver error at it.
              game_type: exposureGameType ?? null,
            },
            lock: transaction.LOCK.UPDATE,
            transaction,
            raw: true,
          });

          const oldExposures = {};
          oldExposuresRows.forEach((r) => (oldExposures[r.team_name] = Number(r.exposure_amount)));

          let newExposures = { ...oldExposures };

          // ── The branch that decides the exposure shape ────────────────
          //    @legacy controller.js:1446-1628, unchanged.
          if (marketsforfancy.includes(market_type)) {
            const S = Number(stake);        // 100
            let L = Number(lay_size);     // 110
            let B = Number(back_size);    // 90
            if (market_type === 'fancy1' || market_type === 'oddeven') {
              const backOdds = runner_odds.find((o) => o.oname === 'back1')?.odds ?? null;
              const layOdds = runner_odds.find((o) => o.oname === 'lay1')?.odds ?? null;
              L = (layOdds - 1) * 100;
              B = (backOdds - 1) * 100;
            }

            const layword = sel + 'lay';
            const backword = sel + 'back';
            if (L === B || OVERS_LINE_MARKETS.includes(market_type)) {
              newExposures[sel] = (oldExposures[sel] || 0) - stake;
              newExposures[layword] = (oldExposures[layword] || 0) + stake;
              newExposures[backword] = (oldExposures[backword] || 0) - stake;
            } else {
              // Previous exposures
              let layExp = Number(oldExposures?.[layword] || 0);
              let backExp = Number(oldExposures?.[backword] || 0);

              const layRisk = (S * L) / 100;   // 110
              const backWin = (S * B) / 100;  // 90

              if (betTypeLower === 'lay') {
                // LAY impact
                layExp += S;        // +100
                backExp -= layRisk; // -110
              } else if (betTypeLower === 'back') {
                // BACK impact
                layExp -= S;        // -100
                backExp += backWin; // +90
              }

              // Current worst exposure after this bet
              const currentWorst = Math.min(layExp, backExp);

              // Store exposures
              newExposures[layword] = layExp;
              newExposures[backword] = backExp;
              newExposures[sel] = currentWorst;

              this.logger?.debug(
                {
                  selection: sel,
                  betType: betTypeLower,
                  stake: S,
                  layBhav: L,
                  backBhav: B,
                  layExposure: layExp,
                  backExposure: backExp,
                  currentWorst,
                },
                '[FANCY EXPOSURE TRACK]'
              );
            }
          } else if (normGameType === 'MO') {
            newExposures = calculateRunnerExposure({
              runners,
              selectedRunner: sel,
              stake,
              odd: oddN,
              betType: betTypeLower,
              oldExposures,
            });
          } else if (normGameType === 'BM') {
            // BOOKMAKER (two-way) using normalized odds
            const newodds = normalizeOdds(oddN);

            newExposures = calculateRunnerExposure({
              runners,
              selectedRunner: sel,
              stake,
              odd: newodds,
              betType: betTypeLower,
              oldExposures,
            });
          } else if (isNonFancyMarket(market_type)) {
            let profit = 0;
            let layLiab = 0;
            if (market_type === 'Tied Match') {
              const new_odds = oddN / 100;
              profit = stake * (new_odds);
              layLiab = stake * (new_odds);
            } else {
              profit = stake * (oddN - 1);
              layLiab = stake * (oddN - 1);
            }

            // ✅ If Draw is selected, ALWAYS update Draw exposure (regardless of count)
            if (isDrawSel) {
              if (betTypeLower === 'back' || betTypeLower === 'yes' || betTypeLower === 'Yes') {
                newExposures['The Draw'] = (oldExposures['The Draw'] || 0) + profit;
                newExposures[team_one] = (oldExposures[team_one] || 0) - stake;
                newExposures[team_two] = (oldExposures[team_two] || 0) - stake;
              } else {
                newExposures['The Draw'] = (oldExposures['The Draw'] || 0) - layLiab;
                newExposures[team_one] = (oldExposures[team_one] || 0) + stake;
                newExposures[team_two] = (oldExposures[team_two] || 0) + stake;
              }
            } else {
              // selection is one of the teams
              const otherTeam = sel === team_one ? team_two : team_one;

              if (betTypeLower === 'back') {
                newExposures[sel] = (oldExposures[sel] || 0) + profit;
                newExposures[otherTeam] = (oldExposures[otherTeam] || 0) - stake;
                // Update Draw if it exists in oldExposures OR if count is 3
                if (count == 3 || oldExposures['The Draw'] !== undefined) {
                  newExposures['The Draw'] = (oldExposures['The Draw'] || 0) - stake;
                }
              } else {
                newExposures[sel] = (oldExposures[sel] || 0) - layLiab;
                newExposures[otherTeam] = (oldExposures[otherTeam] || 0) + stake;
                if (count == 3 || oldExposures['The Draw'] !== undefined) {
                  newExposures['The Draw'] = (oldExposures['The Draw'] || 0) + stake;
                }
              }
            }
          } else if (isFancyMatch(market_type, marketsforBMfancy)) {
            const newodds = normalizeOdds(oddN);
            newExposures = calculateRunnerExposure({
              runners,
              selectedRunner: sel,
              stake,
              odd: newodds,
              betType: betTypeLower,
              oldExposures,
            });
          } else if (isFancyMatch(market_type, marketforfancywithbigrunners)) {
            newExposures = calculateRunnerExposure({
              runners,
              selectedRunner: sel,
              stake,
              odd: oddN,
              betType: betTypeLower,
              oldExposures,
            });
          } else {
            throw new Error(`bet is closed for this market`);
          }

          // WALLET BLOCK - Calculate balance change
          let balanceChange = 0; // +deduct, -release

          if (marketsforfancy.includes(market_type)) {
            const oldNegs = Object.entries(oldExposures)
              .filter(([key, val]) => key === sel && val < 0)
              .map(([, val]) => val);

            const newNegs = Object.entries(newExposures)
              .filter(([key, val]) => key === sel && val < 0)
              .map(([, val]) => val);
            const oldMax = oldNegs.length ? Math.abs(Math.min(...oldNegs)) : 0;
            const newMax = newNegs.length ? Math.abs(Math.min(...newNegs)) : 0;
            const liabInc = newMax - oldMax;

            if (Object.keys(oldExposures).length === 0) balanceChange = newMax;
            else if (liabInc > 0) balanceChange = liabInc;
            else if (liabInc < 0) balanceChange = liabInc; // negative → release

            if (balanceChange > 0 && currentInr < balanceChange) throw new Error('Insufficient balance');
          } else {
            // MO/BM — max negative liability delta
            const oldNegs = Object.values(oldExposures).filter((x) => x < 0);
            const newNegs = Object.values(newExposures).filter((x) => x < 0);
            const oldMax = oldNegs.length ? Math.abs(Math.min(...oldNegs)) : 0;
            const newMax = newNegs.length ? Math.abs(Math.min(...newNegs)) : 0;
            const liabInc = newMax - oldMax;

            if (Object.keys(oldExposures).length === 0) balanceChange = newMax;
            else if (liabInc > 0) balanceChange = liabInc;
            else if (liabInc < 0) balanceChange = liabInc; // negative → release

            if (balanceChange > 0 && currentInr < balanceChange) throw new Error('Insufficient balance');
          }

          //=============================================================================================
          // ✅ STEP 6:                    UPSERT MARKET EXPOSURE OF THE USER
          //============================================================================================
          //
          // @legacy INSERT INTO user_exposures (...) VALUES (...)
          //         ON CONFLICT (user_id, match_id, team_name, game_type) DO UPDATE ...
          //
          // One upsert per outcome, as legacy did, against the same unique key.
          for (const [name, amt] of Object.entries(newExposures)) {
            await UserExposures.upsert(
              {
                user_id: String(user_id),
                match_id: String(match_id),
                team_name: name,
                exposure_amount: amt,
                match_title,
                game_type: exposureGameType,
                event_id: eventid == null ? null : String(eventid),
                category: 'sports',
              },
              {
                conflictFields: ['user_id', 'match_id', 'team_name', 'game_type'],
                transaction,
              }
            );
          }

          // Calculate single bet liability for record keeping
          let singleBetLiability;
          if (market_type === 'fancy1' || market_type === 'oddeven') {
            singleBetLiability = (betTypeLower === 'back') ? stake : ((oddN - 1) * stake);
          } else if (market_type === 'Tied Match') {
            const new_odds = oddN / 100;
            singleBetLiability = (betTypeLower === 'back') ? stake : stake * new_odds;
          } else if (normGameType === 'MO' || marketsfornonfancy.includes(market_type)) {
            singleBetLiability = (betTypeLower === 'back') ? stake : stake * (oddN - 1);
          } else if ((normGameType === 'MO') || (normGameType === 'BM')) {
            const newodds = normalizeOdds(oddN);
            singleBetLiability = (betTypeLower === 'back') ? stake : stake * (newodds - 1);
          } else {
            singleBetLiability = (betTypeLower === 'back') ? stake : (size * stake) / 100;
          }

          const fixed = 0;

          if (!marketsforfancy.includes(market_type)) {
            size = 0;
          }
          if (OVERS_LINE_MARKETS.includes(market_type)) {
            size = 0;
          }

          // Insert bet (use converted bet_type for fancy)
          const finalBetType = (game_type === 'FAN' && bet_type)
            ? (bet_type.toLowerCase() === 'back' ? 'yes' : bet_type.toLowerCase() === 'lay' ? 'no' : bet_type)
            : bet_type;

          //=============================================================================================
          // ✅ STEP 7:                  SAVING BET TO DATABASE
          //=============================================================================================

          const startTime = match_start_time || new Date();

          // @legacy INSERT INTO "SportsBet" (...) VALUES (...) RETURNING *
          //
          // `runners` goes in as the array. Legacy passed `JSON.stringify(runners)`
          // to a JSONB column, which Postgres casts back to the array — the same
          // stored value, one conversion fewer.
          //
          // `category + "1"` is legacy's, verbatim: string concatenation, so
          // `category: "0"` is stored as `"01"`.
          //
          // `usd_amount` had `|| (await inrToUsd(stake))` as its fallback and
          // `inrToUsd` IS NOT DEFINED anywhere in `legacy/sportsmain` — a payload
          // without `usd_amount` threw a ReferenceError into the catch and lost
          // the bet with "usd_amount is not defined". Null, rather than that.
          let newBet;
          try {
            newBet = await SportsBet.create(
              {
                user_id,
                game_type: normGameType,
                match_id: match_id == null ? null : String(match_id),
                match_title,
                team_one,
                team_two,
                selection_name,
                category: category + '1',
                bet_type: finalBetType,
                odds: oddN,
                stake_amount: stake,
                original_currency: original_currency || 'INR',
                original_amount: original_amount || stake,
                usd_amount: usd_amount ?? null,
                liability: singleBetLiability,
                match_start_time: startTime,
                exposure_after_bet: Math.max(0, ...Object.values(newExposures).filter((v) => v < 0).map((v) => Math.abs(v)), 0),
                status: 'open',
                eventid: eventid == null ? null : String(eventid),
                ip_address,
                fancy_name: fancy_name || 'NULL',
                fixed,
                counts: count,
                sport_id: sid == null ? null : String(sid),
                market_type,
                unmatched: unmatched || false,
                unmatched_odds: unmatched_odds || null,
                size,
                runners,
                event_name,
                lay_size: lay_size || null,
                back_size: back_size || null,
              },
              { transaction }
            );
          } catch (err) {
            this.logger?.error({ err, user_id, match_id, market_type }, 'Query Failed ❌');
            throw new Error('Erro in insert sports bet.');
          }

          //=============================================================================================
          // ✅ STEP 8: [PLATFORM SPECIFIC: LORDS] WALLET UPDATE : Deduct or Release
          //=============================================================================================
          //
          // @legacy UPDATE credits SET inr = inr - $1 WHERE uid = $2
          //
          // `increment` by the negated change, so a release (`balanceChange < 0`)
          // adds it back exactly as `inr - (-x)` did.
          if (balanceChange !== 0) {
            await Credits.increment(
              { inr: -balanceChange },
              { where: { uid: String(user_id) }, transaction }
            );
          }

          // ========================================================================================
          // ✅ STEP 9:  CALCULATE NET EXPOSURE OF THIS BET (most negative among 2-3 outcomes)
          // ========================================================================================
          const betExposureValues = Object.values(newExposures);

          // Find the net exposure of this bet: pick the most negative (minimum value)
          let betNetExposure = 0;
          if (betExposureValues.length > 0) {
            const minValue = Math.min(...betExposureValues);
            betNetExposure = minValue < 0 ? Math.abs(minValue) : 0;
          }

          // ========================================================================================
          // ✅ STEP 10:              UPSERT TOTAL EXPOSURE RECORD
          // ========================================================================================
          let totalUserExposure = 0;

          // @legacy SELECT * FROM user_exposures WHERE user_id = $1
          const matchExposures = await UserExposures.findAll({
            where: { user_id: String(user_id) },
            transaction,
            raw: true,
          });

          // Group by match_id (+ game_type if you want stricter separation)
          const exposureMap = {};

          for (const exp of matchExposures) {
            const key = `${exp.match_id}`; // or `${exp.match_id}_${exp.game_type}`

            const amount = Number(exp.exposure_amount) || 0;

            if (!exposureMap[key]) {
              exposureMap[key] = 0;
            }

            // Only count negative exposure (liability)
            if (amount < 0) {
              exposureMap[key] += Math.abs(amount);
            }
          }

          // Sum all match liabilities
          for (const matchKey in exposureMap) {
            totalUserExposure += exposureMap[matchKey];
          }

          const newBalance = balanceChange !== 0 ? currentInr - balanceChange : currentInr;

          this.logger?.info(
            {
              user_id, betId: newBet?.id, match_id, game_type: normGameType,
              selection_name, bet_type: finalBetType, odds: oddN, stake,
              balanceChange, betNetExposure, totalUserExposure,
            },
            'Sports bet placed'
          );

          return {
            status: 200,
            body: {
              success: true,
              exposure: { [match_id]: { match_title, teams: newExposures } },
              balanceDelta: newBalance - currentInr,
              oldBalance: currentInr,
              newBalance,
              totalExposure: totalUserExposure,
            },
          };
        },
        { transaction }
      );

      return result;
    });
    /* eslint-enable camelcase */
  }

  // ══════════════════════════════════════════════════════════════════════
  //  A player's own bets
  // ══════════════════════════════════════════════════════════════════════

  /**
   * `matchId` matches the MARKET or the EVENT, because a bet row carries both.
   *
   * `place` writes `match_id` = the provider's MARKET id (`7116847500521`) and
   * `eventid` = the GAME id (`841080139`) — the board posts `market_id` as
   * `match_id`, and has since legacy. So one match produces rows under several
   * different `match_id`s: one per market, plus one per fancy session.
   *
   * Legacy's per-event reads knew this and filtered `eventid`
   * (`userOpenBets`, controller.js:2535); its per-market reads filtered
   * `match_id` (`openBetsByMatch`, controller.js:2312). The port kept only the
   * `match_id` half, so the board asking for `?matchId=<gmid>` matched no row
   * and every screen showed "no open bets" against a table full of them.
   *
   * Matching either column serves both callers with one predicate: a market id
   * never collides with a game id in the provider's own numbering.
   */
  static #matchOrEvent(matchId, eventColumn) {
    const id = String(matchId);
    return { [Op.or]: [{ match_id: id }, { [eventColumn]: id }] };
  }

  /**
   * @legacy GET /sportsbetting/open/:userUuid/:matchId
   * @legacy GET /api/sportsmain/open/:user_id/:match_id
   *
   * Open bets on one match. Both legacy versions took the player from the URL
   * on an unauthenticated route.
   */
  async openBets({ userId, matchId }) {
    const rows = await this.models.SportsBet.findAll({
      where: {
        user_id: String(userId),
        status: BET_STATUS.OPEN,
        ...BetsService.#matchOrEvent(matchId, 'eventid'),
      },
      order: [['created_at', 'DESC']],
      raw: true,
    });
    return rows.map((r) => this.#shapeBet(r));
  }

  /**
   * @legacy GET /sportsbetting/history/:userUuid
   * @legacy GET /api/sportsmain/history/:user_id/:match_id
   *
   * Legacy's version was `SELECT ... WHERE user_id = $1 ORDER BY created_at
   * DESC` with NO LIMIT — a player with a long history got every row they had
   * ever placed in one response.
   */
  async history({ userId, matchId, status, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.SportsBet.findAndCountAll({
      where: {
        user_id: String(userId),
        ...(matchId ? BetsService.#matchOrEvent(matchId, 'eventid') : {}),
        ...(status ? { status } : {}),
      },
      order: [['created_at', 'DESC']],
      limit,
      offset,
      raw: true,
    });
    return { total: count, rows: rows.map((r) => this.#shapeBet(r)) };
  }

  /**
   * The player's own sports bet and win counts, for their profile panel.
   *
   * Counts every bet they have PLACED, open ones included — the line it feeds
   * reads "Total Bets", not "settled bets". `turnover()` in the wager-report
   * module counts settled bets only, deliberately: a wagering requirement must
   * not be satisfiable with bets that have not resolved. The two numbers
   * answer different questions and are meant to differ.
   *
   * A refunded bet was never really risked, so it is neither. That exclusion
   * reads `result_status`, not `status`: a refund leaves the bet `closed` like
   * any other resolved bet, and the `status: { [Op.ne]: 'void' }` this used to
   * carry named a status nothing ever writes, so it excluded nothing.
   */
  async summary({ userId }) {
    const [row] = await this.models.SportsBet.findAll({
      where: {
        user_id: String(userId),
        [Op.or]: [
          { result_status: null },
          { result_status: { [Op.notIn]: REFUNDED_RESULTS } },
        ],
      },
      attributes: [
        [fn('COUNT', col('id')), 'bets'],
        [literal(`COUNT(*) FILTER (WHERE result_status = 'won')`), 'wins'],
      ],
      raw: true,
    });

    return { bets: Number(row?.bets ?? 0), wins: Number(row?.wins ?? 0) };
  }

  /**
   * @legacy GET /sportsbetting/opencount/:userUuid
   * @legacy GET /api/sportsmain/opencount/:user_id
   */
  async openCount({ userId }) {
    const rows = await this.models.SportsBet.findAll({
      attributes: ['match_id', [fn('COUNT', col('id')), 'count']],
      where: { user_id: String(userId), status: BET_STATUS.OPEN },
      group: ['match_id'],
      raw: true,
    });

    return {
      total: rows.reduce((sum, r) => sum + Number(r.count), 0),
      byMatch: rows.map((r) => ({ matchId: r.match_id, count: Number(r.count) })),
    };
  }

  /**
   * @legacy GET /sportsbetting/exposures/:user_id
   * @legacy GET /api/sportsmain/exposures/:user_id
   * @legacy GET /api/sportsmain/bets/exposure/:user_id
   * @legacy POST /api/sportsmain/matchexposures/match
   *
   * Four endpoints over the same table, in four shapes, all naming the player
   * in the URL or body without authenticating them.
   */
  async exposures({ userId, matchId }) {
    const rows = await this.models.UserExposures.findAll({
      where: {
        user_id: String(userId),
        // `user_exposures` spells the game id `event_id`, not `eventid`.
        ...(matchId ? BetsService.#matchOrEvent(matchId, 'event_id') : {}),
      },
      raw: true,
    });

    const byMatch = new Map();
    for (const row of rows) {
      const key = String(row.match_id);
      if (!byMatch.has(key)) {
        byMatch.set(key, { matchId: key, matchTitle: row.match_title, outcomes: {} });
      }
      /**
       * `fromStored`, not `toMinor` — this is a READ of a bare `numeric`.
       *
       * `user_exposures.exposure_amount` has no declared scale, and `place`
       * computes it with legacy's float arithmetic, so real rows carry values
       * like `-37.000000000000014`. `toMinor` refuses anything past eight
       * decimal places, which is right for a write and fatal for a read: one
       * such row made this endpoint answer 400 for the whole match, so the
       * board showed no exposure at all rather than one over-precise number.
       */
      byMatch.get(key).outcomes[row.team_name] = money.fromStored(row.exposure_amount ?? '0');
    }

    return [...byMatch.values()].map((entry) => ({
      ...entry,
      // The number actually blocked — the worst outcome. Legacy returned the
      // raw per-outcome numbers and left every caller to work this out, which
      // is why the admin screens and the bet path disagreed about it.
      liability: worstCase(entry.outcomes),
    }));
  }

  // ══════════════════════════════════════════════════════════════════════

  #shapeBet(row) {
    return {
      id: row.id,
      matchId: row.match_id,
      matchTitle: row.match_title,
      gameType: row.game_type,
      selection: row.selection_name,
      side: row.bet_type,
      odds: String(row.odds ?? '0'),
      stake: money.toDecimalString(money.toMinor(row.stake_amount ?? '0')),
      liability: money.toDecimalString(money.toMinor(row.liability ?? '0')),
      status: row.status,
      resultStatus: row.result_status ?? null,
      createdAt: row.created_at,

      /**
       * The rest of the player's own bet slip.
       *
       * `eventId` in particular is not decoration: every "my bets" card links
       * through to `/sports/markets/:eventId`, and without it on the payload
       * that link resolved to `undefined` for every bet. `marketType` and
       * `fancyName` are what distinguishes one fancy session from another on
       * the same match — they are the difference between a legible bet list and
       * six rows that all read the same.
       */
      eventId: row.eventid ?? null,
      sportId: row.sport_id ?? null,
      marketType: row.market_type ?? null,
      fancyName: row.fancy_name ?? null,
      teamOne: row.team_one ?? null,
      teamTwo: row.team_two ?? null,
      matchStartTime: row.match_start_time ?? null,
      matchEndTime: row.match_end_time ?? null,
      // Deliberately NOT `ip_address`. It is on the row for fraud review and is
      // not a player's own business to read back.
    };
  }
}

/**
 * Bookmaker prices are quoted as integers.
 *
 * NOT the one the bet path uses — that is `normalizeOdds` from
 * `legacy/markets.js`, copied out of the legacy controller, and it is applied
 * exactly where legacy applied it. This one is kept because `exposure.test.js`
 * covers it and settlement's own reading of the same problem is documented on
 * it: the feed sends `50` for 1.50 and `236` for 2.36 on bookmaker markets, and
 * legacy normalised in the exposure maths but NOT when writing `odds` onto the
 * bet row — so the row said 236 and the liability came from 2.36.
 */
function normaliseOdds(odds) {
  const value = Number(odds);
  if (!Number.isFinite(value)) return String(odds);
  // Anything above 10 on a bookmaker market is an integer quote: 150 → 2.50.
  return value > 10 ? String(1 + value / 100) : String(value);
}

module.exports = { BetsService, normaliseOdds };
