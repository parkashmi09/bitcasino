'use strict';

const { Op, literal } = require('sequelize');
const { money, assertCurrencySupportedFor } = require('@ibitplay/common');
const { GamesService } = require('../../games/games.service');
const { assertInHouseEntitled } = require('../../games/gameEntitlement');

const errors = require('../inHouse.errors');
const { HOUSE_EDGE_PERCENT, COIN_COLUMNS, PLAY_COIN_BLOCKED } = require('../inHouse.constants');

/**
 * The shared play/settle path for the sixteen in-house games.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE GAME BEHAVIOUR IS PORTED AS-IS. THE MONEY PATH IS NOT A GAME BEHAVIOUR.
 *
 * On instruction, the games' rules, payouts and result generation are carried
 * over unchanged — see `hash.js` and each file under `games/`.
 *
 * What the engine does differently is HOW the stake moves, because that is
 * infrastructure rather than gameplay and legacy's version loses money:
 *
 *   `Rule.preparePlay` — `makeBetBeforePlay` then `reduceBalance`, two
 *   statements, no transaction. `reduceBalance` is
 *   `UPDATE credits SET ${coin} = ${coin} - $2` with NO FLOOR, and the
 *   affordability check is an unlocked `getClientCoinCredit` read in
 *   `CanPlay`, several callbacks earlier. Two simultaneous bets both pass it
 *   and the balance goes negative. If the bet row insert fails, the stake is
 *   taken and no bet exists.
 *
 *   `Rule.prepareBusted` — `updateBetAfterFinish` then `updateProfit`, again
 *   unrelated statements. A failure between them settles the bet without
 *   paying it.
 *
 * Here a bet is ONE transaction with a guarded debit, and a settlement is one
 * transaction with the payout and the bet row together. The numbers are
 * legacy's; the guarantee that they add up is not.
 *
 * ── AND THE QUEUE IS GONE ────────────────────────────────────────────────
 *
 * Legacy tracked in-flight bets in an in-process `Queue`, keyed on uid, with a
 * `plinko` special case (`if (game === "plinko") exists = false;`) and a
 * recursive 150ms retry when a player was already in it. One process only, lost
 * on restart, and the retry recursed without a depth bound. The bet row itself
 * is the record of an in-flight bet.
 */

/**
 * `H.makeGameID`, kept for the `gid` column only.
 *
 * Legacy's version, with `getYear()` (deprecated, year-1900) and `getUTCDay()`
 * (day of the week) exactly as written — because the column's historical values
 * have that shape and nothing gains from a different one. See `placeBet` for
 * why nothing keys on it.
 */
function makeGameId(add = 0) {
  const now = new Date();
  const date =
    // eslint-disable-next-line no-restricted-properties
    now.getYear().toString() +
    now.getUTCMonth().toString() +
    now.getUTCDay().toString() +
    now.getUTCHours().toString() +
    now.getUTCMinutes().toString() +
    now.getUTCSeconds().toString();

  return parseFloat(date.substr(5).toString() + Math.floor(Math.random() * 100)) + add;
}

class GameEngine {
  constructor({ models, db, logger, config, clients }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    /** rainbet: user-service, for the player's own break / limit before a stake. */
    this.clients = clients;
    /**
     * `recordPlay` and the wager counters live with the catalogue they are
     * about. Same service, same models — a plain collaborator, not an HTTP hop.
     * `clients` reaches user-service for the VIP on-wager sync.
     */
    this.games = new GamesService({ models, db, config, logger, clients });
  }

  /**
   * Take the stake and open a bet.
   *
   * `Rule.CanPlay` + `Rule.preparePlay`, as one atomic operation.
   *
   * @returns {{betId: string, balance: string}}
   */
  async placeBet({ userId, game, coin, amount, data }) {
    const currency = String(coin ?? '').toUpperCase();
    // The in-house engine settles on `credits` columns only; an owner-created
    // coin (wallet_balances) is refused by name: CURRENCY_NOT_SUPPORTED_FOR_GAMES.
    assertCurrencySupportedFor('GAMES', currency);
    const column = COIN_COLUMNS[currency];
    if (!column) throw errors.UNSUPPORTED_COIN({ coin: currency });

    // Legacy's `if (coin === "nc") return callback(true)` in the bankroll
    // check — `nc` is play money and never touches the real path.
    if (PLAY_COIN_BLOCKED.includes(currency)) throw errors.UNSUPPORTED_COIN({ coin: currency });

    const stake = money.toMinor(String(amount ?? '0'));
    // Legacy's four consecutive `bet <= 0` checks, which are one check.
    if (stake <= 0n) throw errors.INVALID_STAKE({ amount });

    // The owner's plan: Originals (and casino, and crash for the crash games)
    // must be in it before a stake is taken. 403 NOT_ENTITLED, nothing debited.
    await assertInHouseEntitled(game);

    // The admin's Casino lock / Account lock (Risk management) stops in-house play too, as it does provider games.
    const locks = await this.models.Users.findOne({ where: { id: userId }, attributes: ['casino_locked', 'system_locked', 'is_demo'], raw: true });
    if (locks?.is_demo) throw errors.DEMO_NOT_ALLOWED({ userId });
    if (locks?.casino_locked || locks?.system_locked) throw errors.CASINO_LOCKED({ userId });

    const decimal = money.toDecimalString(stake);

    // rainbet: the player's own break or loss / wager limit (user-service responsible-gambling). This
    // engine debits `credits` itself rather than through the wallet's `debit`, so it asks first; a
    // refusal is the wallet's own 403 RESPONSIBLE_* and nothing is debited.
    await this.clients.user.post('/internal/user/responsible-gambling/check', { userId: String(userId), currency, amount: decimal, sports: false });

    const opened = await this.db.transaction(async (transaction) => {
      /**
       * The GUARDED debit. `WHERE <column> >= stake`, and the row count is the
       * answer — Postgres decides whether the player can afford it, at the
       * moment of the write.
       *
       * Legacy read the balance in `CanPlay`, compared it in JavaScript, and
       * then debited unconditionally several callbacks later.
       */
      const [affected] = await this.models.Credits.update(
        { [column]: literal(`"${column}" - ${decimal}`) },
        { where: { uid: userId, [column]: { [Op.gte]: decimal } }, transaction }
      );

      if (!affected) throw errors.INSUFFICIENT_BALANCE({ coin: currency });

      const player = await this.models.Users.findOne({
        where: { id: userId },
        attributes: ['name'],
        transaction,
        raw: true,
      });

      const bet = await this.models.Bets.create(
        {
          uid: userId,
          /**
           * `gid` is NOT NULL, so it is populated — but nothing keys on it.
           *
           * ─────────────────────────────────────────────────────────────
           * `H.makeGameID()` COLLIDES, AND SETTLEMENT KEYED ON IT
           *
           *     let date = current.getYear() + getUTCMonth() + getUTCDay() +
           *                getUTCHours() + getUTCMinutes() + getUTCSeconds();
           *     var c = date.substr(5) + Math.floor(Math.random() * 100);
           *     return parseFloat(c) + add;
           *
           * A few digits of the clock plus a random 0–99. Two bets in the
           * same second collide one time in a hundred — and
           * `updateBetAfterFinish` settles with
           *
           *     UPDATE bets SET profit=$1, result=$2, hash=$3
           *      WHERE gid = $4 AND uid = $5
           *
           * so a collision for one player settles the wrong bet, or both with
           * one result. (`getUTCDay()` is the day of the WEEK, 0–6, not the
           * date — so the "date" prefix repeats weekly too, and `getYear()`
           * has been deprecated since 1999.)
           *
           * Every operation here keys on `bets.id`, which is a real sequence.
           * `gid` is filled for anything still reading the column.
           * ─────────────────────────────────────────────────────────────
           */
          gid: makeGameId(),
          name: player?.name ?? null,
          game,
          coin: currency.toLowerCase(),
          amount: decimal,
          profit: '0',
          // Filled in by `settle`. Legacy wrote them in a second statement too.
          hash: null,
          result: null,
          created: new Date(),
        },
        { transaction }
      );

      const balance = await this.#balance(userId, column, transaction);

      // The stake's ledger row, in the same transaction as the debit — the
      // wallet must reconcile against its own ledger (see `#writeLedger`).
      await this.#writeLedger(
        {
          userId, username: player?.name, currency, signed: -stake, newBalance: balance,
          reason: 'BET_STAKE', betId: bet.id, game,
        },
        transaction
      );

      return { betId: String(bet.id), balance, stake: decimal, currency, column };
    });

    /**
     * AFTER the transaction, and deliberately outside it.
     *
     * A bet counts toward a wagering requirement when it is PLACED, not when
     * it wins — the requirement measures turnover — so the stake is recorded
     * here rather than in `settle`. Recording it in `settle` would also miss
     * a round that never settles.
     *
     * Outside the transaction because these three writes are bookkeeping about
     * the bet, not part of it: a failed counter must never roll back a debit
     * that already happened. `recordActivity` swallows and logs its own
     * failures for the same reason.
     */
    /* `ref` is the bet row: the count is exactly-once per bet, converted to
       USD by user-service, and the in-house engine now accrues rakeback too. */
    await this.games
      .recordActivity({
        userId,
        gameRef: game,
        wagered: decimal,
        currency,
        source: 'inhouse',
        ref: opened.betId,
        category: 'originals',
        provider: 'BC Originals',
        // A round is counted in `games_played` when it SETTLES (see `settle`),
        // so a refunded or invalid round is not a game played.
        countPlay: false,
      })
      .catch((error) => this.logger?.warn({ err: error, betId: String(opened.betId) }, 'Wager feed failed — the bet stands'));

    return opened;
  }

  /**
   * Settle a bet and pay it.
   *
   * `Rule.prepareBusted`, as one atomic operation.
   *
   * `profit` is the game's own number, computed by the game's own arithmetic —
   * this does not recompute it. What it does is apply the same house-edge
   * formula legacy applied and move the money in one statement.
   */
  async settle({ userId, betId, profit, result, hash, isWinner, coin, amount }) {
    const currency = String(coin ?? '').toUpperCase();
    const column = COIN_COLUMNS[currency];
    if (!column) throw errors.UNSUPPORTED_COIN({ coin: currency });

    const stake = money.toMinor(String(amount ?? '0'));

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * `toMinorQuantised`, NOT `toMinor` — AND THIS IS NOT THE CASE THAT
     * FUNCTION'S HEADER WARNS ABOUT
     *
     * Every game computes its profit in JS floats and stringifies the result:
     *
     *     profit = stake * target - stake      // games/limbo.js
     *     return { …, profit: String(profit) }
     *
     * For a 10 stake at 1.02× that is `0.19999999999999928` — SEVENTEEN
     * decimal places. `toMinor` refuses anything over eight, correctly, so the
     * round threw `BAD_REQUEST: amount supports at most 8 decimal places`
     * after the stake had been taken. `sockets.js` caught it and refunded, so
     * no money was lost — but the round died, and it died for most
     * multipliers rather than a rare few. 2.00× settles; 1.02× never did.
     *
     * `toMinorQuantised`'s header says it is for reading stored balances and
     * NEVER for a request body. This is neither. The over-precision here is an
     * artifact of arithmetic THIS SERVER just performed on its own numbers —
     * `0.19999999999999928` is a float's way of writing `0.20`, not a claim to
     * precision the platform cannot hold, and not something a player supplied.
     * Rounding it half-away-from-zero to the platform's scale is what the value
     * already meant. Refusing it only loses the round.
     *
     * The stake above stays on strict `toMinor`: that one DOES come from the
     * player's message, and an over-precise stake is exactly the input the
     * strict parser exists to reject.
     * ═══════════════════════════════════════════════════════════════════════
     */
    const won = money.toMinorQuantised(String(profit ?? '0'), { field: 'profit' });

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * WHAT IS PAID IS WHAT IS RECORDED
     *
     * Legacy's payout arithmetic:
     *
     *     var percent = (houseEdge / 100) * amount;
     *     var calculateHouse = amount - percent;
     *     var amountAndProfit = profit + calculateHouse;
     *
     * The engine's 2% house edge (`HOUSE_EDGE_PERCENT`, shown on the admin
     * In-house page and priced into games such as Magic Wheel, whose odds are
     * fair before it) is kept: a round that wins or loses returns the stake
     * less 2%, plus the game's profit.
     *
     * What changed is the RECORD. `bets.profit`, the socket reply and every
     * report built on them used to carry the game's gross profit while the
     * wallet received 2% of the stake less — ₹10 at 2× recorded +10 and paid
     * +9.80. Now `profit` is `payout − stake`: the net the player actually
     * received, so Bet History, P&L / GGR and the agent tree add up to the
     * ledger.
     *
     * A PUSH (the game's profit is exactly 0 — a blackjack push, a Limbo /
     * Hash Dice tie, Plinko's 1.00× slot, a cash-out before any step) returns
     * the FULL stake. Taking 2% of a stake on a round that neither won nor
     * lost is a fee, not an edge, and recorded as profit 0 it was invisible.
     * ═══════════════════════════════════════════════════════════════════════
     */
    const push = won === 0n;
    const houseCut = push ? 0n : (stake * BigInt(Math.round(HOUSE_EDGE_PERCENT * 100))) / 10_000n;
    const gross = stake + won - houseCut;
    const payout = gross > 0n ? gross : 0n;
    const net = payout - stake;

    return this.db.transaction(async (transaction) => {
      const bet = await this.models.Bets.findOne({
        where: { id: betId, uid: userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!bet) throw errors.BET_NOT_FOUND({ betId });
      /**
       * A bet settles ONCE. Legacy had no such check — `updateBetAfterFinish`
       * was an unconditional UPDATE, so a duplicate settle paid twice.
       */
      if (bet.result !== null && bet.result !== undefined) {
        throw errors.ALREADY_SETTLED({ betId });
      }

      await bet.update(
        {
          profit: money.toDecimalString(net),
          // `bets.result` is a JSON column. Legacy `JSON.stringify`d into it,
          // which for a bare number stores a JSON number — kept.
          result,
          hash,
        },
        { transaction }
      );

      if (payout > 0n) {
        await this.models.Credits.increment(
          { [column]: money.toDecimalString(payout) },
          { where: { uid: userId }, transaction }
        );
      }

      const balance = await this.#balance(userId, column, transaction);

      if (payout > 0n) {
        await this.#writeLedger(
          {
            userId, username: bet.name, currency, signed: payout, newBalance: balance,
            reason: 'BET_PAYOUT', betId, game: bet.game,
          },
          transaction
        );
      }

      // A settled round is a game played — once, because a bet settles once.
      await this.models.Users.increment({ games_played: 1 }, { where: { id: userId }, transaction });

      return {
        betId: String(betId),
        profit: money.toDecimalString(net),
        payout: money.toDecimalString(payout),
        balance,
        result,
        hash,
        isWinner: Boolean(isWinner),
      };
    });
  }

  /**
   * Refund an open bet.
   *
   * Legacy had no path for this at all: if a game threw between `preparePlay`
   * and `prepareBusted` — which several do, on an `assert` — the stake was
   * gone and the bet row sat open forever.
   */
  async refund({ userId, betId, coin, amount }) {
    const column = COIN_COLUMNS[String(coin ?? '').toUpperCase()];
    if (!column) throw errors.UNSUPPORTED_COIN({ coin });

    const outcome = await this.db.transaction(async (transaction) => {
      const bet = await this.models.Bets.findOne({
        where: { id: betId, uid: userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!bet || bet.result !== null) return { refunded: false };

      await bet.update({ profit: '0', result: 'refunded' }, { transaction });
      const refunded = money.toMinor(String(amount ?? '0'));
      await this.models.Credits.increment(
        { [column]: money.toDecimalString(refunded) },
        { where: { uid: userId }, transaction }
      );
      if (refunded > 0n) {
        await this.#writeLedger(
          {
            userId, username: bet.name, currency: String(coin).toUpperCase(), signed: refunded,
            newBalance: await this.#balance(userId, column, transaction),
            reason: 'BET_REFUND', betId, game: bet.game,
          },
          transaction
        );
      }

      this.logger?.warn({ userId: String(userId), betId: String(betId) }, 'In-house bet refunded');
      return { refunded: true };
    });

    /* The stake was counted when the bet was placed (`inhouse:<bet id>`); a
       refunded bet is no turnover, so it stops counting — after the refund
       has committed, best-effort, never failing it. */
    if (outcome.refunded) {
      await this.games
        .reverseActivity({ userId, source: 'inhouse', ref: betId, outbox: true })
        .catch((error) => this.logger?.warn({ err: error, betId: String(betId) }, 'Wager reversal failed — the refund stands'));
    }
    return outcome;
  }

  /**
   * The `house` counters, read exactly as legacy read them.
   *
   * ─────────────────────────────────────────────────────────────────────
   * `Rule.checkLimited` → `Agent.canProfit` → `UserRule.checkMaxProfit`:
   *
   *     SELECT * FROM house WHERE uid = $1
   *     callback(current < max)
   *
   * The returned flag is passed into each game's `Result.make(status, …)`,
   * where a false value causes a winning roll to be discarded and replaced.
   * Carried over unchanged, on instruction — see `docs/SOCKETS.md` §2 for what
   * it does, and each game file under `games/` for where it is applied.
   *
   * Legacy did `results.rows[0].current` with no existence check, so a player
   * with no `house` row threw `TypeError` on every bet. Defaults to `true`
   * here, which is the permissive reading.
   * ─────────────────────────────────────────────────────────────────────
   */
  async canProfit(userId) {
    const row = await this.models.House.findOne({ where: { uid: userId }, raw: true });
    if (!row) return true;
    return Number(row.current ?? 0) < Number(row.max ?? 0);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Multi-step rounds
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Open a round: take the stake, draw the outcome, store it.
   *
   * Replaces `Rule.preparePlay` + `Queue.add` + several `Queue.update` calls.
   * See migration 030 for what the in-process queue cost.
   */
  async openRound({ userId, game, coin, amount, state, hash }) {
    const bet = await this.placeBet({ userId, game, coin, amount });

    try {
      const round = await this.models.InHouseRound.create({
        bet_id: bet.betId,
        user_id: userId,
        game,
        coin: bet.currency,
        amount: bet.stake,
        state,
        selected: [],
        steps: 0,
        profit: '0',
        hash,
        status: 'open',
        created_at: new Date(),
        updated_at: new Date(),
      });

      return { roundId: String(round.id), betId: bet.betId, balance: bet.balance, stake: bet.stake, currency: bet.currency };
    } catch (error) {
      /**
       * The stake is already taken. A unique-constraint failure here means the
       * player already has an open round of this game — legacy's `Queue.exists`
       * check, enforced by the database. Either way the stake goes back.
       */
      await this.refund({ userId, betId: bet.betId, coin: bet.currency, amount: bet.stake }).catch(() => {});

      if (error?.name === 'SequelizeUniqueConstraintError') throw errors.ROUND_ALREADY_OPEN({ game });
      throw error;
    }
  }

  /** The player's open round, or a refusal. */
  async openRoundFor({ userId, game }) {
    const round = await this.models.InHouseRound.findOne({
      where: { user_id: userId, game, status: 'open' },
    });
    /**
     * Legacy answered a missing round with `console.log('Client Not Playing!')`
     * and dropped the message — the client waited for a reply that never came,
     * with its stake already gone.
     */
    if (!round) throw errors.NO_OPEN_ROUND({ game });
    return round;
  }

  /**
   * Record a step. The outcome stays hidden until the round ends.
   *
   * ═════════════════════════════════════════════════════════════════════════
   * `state` IS PART OF A STEP, AND DROPPING IT BROKE HILO COMPLETELY
   *
   * Only `selected` and `profit` were written here. Most of the multi-step
   * games do not care — Mines, Tower, Goal and Snake & Ladders decide a click
   * against a board that was fixed when the round opened, so their state never
   * changes.
   *
   * HiLo's does. `games/hilo.js` `step` returns
   *
   *     state: { ...state, result, next: next + 1 }
   *
   * and that `next` is the position in the deck. Discarded, `next` stayed `0`,
   * so every turn of the round compared `result[0]` against `result[1]` — the
   * same two cards, forever. Which means the round was decided by the deal:
   *
   *   `result[0] >= result[1]`  every turn wins, the round NEVER ends, and
   *                             each one pays another `stake / 3`. A player who
   *                             kept clicking was minting money.
   *   otherwise                 the first turn loses, always.
   *
   * Roughly half of all rounds were the first kind. Persisting what the game
   * returns is the whole fix; `?? round.state` keeps the games that return
   * nothing exactly as they were.
   * ═════════════════════════════════════════════════════════════════════════
   */
  async stepRound({ round, selected, profit, state }) {
    await round.update({
      selected,
      state: state ?? round.state,
      steps: round.steps + 1,
      profit: profit !== undefined ? String(profit) : round.profit,
      updated_at: new Date(),
    });
    return round;
  }

  /**
   * End a round and settle its bet.
   *
   * One transaction covering the round row and the payout, so a round can
   * never be marked finished without the money moving.
   */
  async closeRound({ round, profit, result, isWinner, status }) {
    const settled = await this.settle({
      userId: round.user_id,
      betId: round.bet_id,
      profit,
      result,
      hash: round.hash,
      isWinner,
      coin: round.coin,
      amount: round.amount,
    });

    await round.update({
      status: status ?? (isWinner ? 'cashed_out' : 'lost'),
      // The net actually paid, the same figure as `bets.profit`.
      profit: settled.profit,
      updated_at: new Date(),
    });

    return settled;
  }

  /**
   * The ledger + history rows for one in-house money movement.
   *
   * Every other wallet move — user-service's `#writeRecords`, the admin
   * opening balance — writes a signed `credits_ledger` row and a
   * `wallet_history` row in the SAME transaction as the balance change. The
   * in-house engine changed `credits` directly and wrote neither, so a player's
   * wallet drifted from the sum of its ledger by every house-game round and
   * reconcile reported `balanced: false`.
   *
   * Written here, inside the engine's transaction, rather than through
   * user-service: the bet row, the balance and the record must commit
   * together. The idempotency key follows `WalletClient.key`'s shape
   * (`casino-service:<REASON>:INHOUSE:<bet id>`), so the partial unique index on
   * `credits_ledger.idempotency_key` also refuses a second stake, payout or
   * refund for the same bet.
   *
   * `newBalance` is read after the change while the row lock is held, so
   * `previousBalance = newBalance − signed` is exact.
   */
  async #writeLedger({ userId, username, currency, signed, newBalance, reason, betId, game }, transaction) {
    const amount = money.toDecimalString(signed);
    const magnitude = money.toDecimalString(signed < 0n ? -signed : signed);
    const previousBalance = money.toDecimalString(money.toMinor(newBalance) - signed);
    const description = `Originals ${game ?? 'game'} ${reason === 'BET_STAKE' ? 'stake' : reason === 'BET_PAYOUT' ? 'payout' : 'refund'} #${betId}`;

    await this.models.CreditsLedger.create(
      {
        user_id: String(userId),
        currency,
        amount,
        reason,
        description,
        balance: newBalance,
        closing: newBalance,
        netamount: 0,
        profit: 0,
        loss: 0,
        commission: 0,
        idempotency_key: `casino-service:${reason}:INHOUSE:${betId}`,
        source_service: 'casino-service',
        meta: { refType: 'INHOUSE', refId: String(betId), game: game ?? null, previousBalance },
      },
      { transaction }
    );

    await this.models.WalletHistory.create(
      {
        uid: userId,
        username: username || String(userId),
        coin: currency,
        operation: signed < 0n ? 'debit' : 'credit',
        amount: magnitude,
        previous_balance: previousBalance,
        new_balance: newBalance,
        description,
        transaction_time: new Date(),
      },
      { transaction }
    );
  }

  async #balance(userId, column, transaction) {
    const row = await this.models.Credits.findOne({
      where: { uid: userId },
      attributes: [column],
      transaction,
      raw: true,
    });
    return money.toDecimalString(money.toMinor(row?.[column] ?? '0'));
  }
}

module.exports = { GameEngine };
