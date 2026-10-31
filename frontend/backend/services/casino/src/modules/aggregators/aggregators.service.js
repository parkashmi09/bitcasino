'use strict';

const crypto = require('crypto');
const { money } = require('@ibitplay/common');

const {
  AGGREGATOR,
  ASIA_ERROR,
  NEXUS_MSG,
  SETTLEMENT_CURRENCY,
  ASIA_DISPLAY_CURRENCY,
  NEXUS_GAME_TYPES,
} = require('./aggregators.constants');

/**
 * The three remaining casino wallet callbacks.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NONE OF THE THREE HAD ANY AUTHENTICATION
 *
 * `/processRequest` is the clearest:
 *
 *     server.post("/processRequest", async (req, res) => {
 *       const { cmd, login, bet, win, ... } = req.body;
 *       ...
 *       } else if (cmd === "writeBet") {
 *         const newBalance = parseFloat(userBalance) - parseFloat(bet) + parseFloat(win);
 *         await updateUserBalanceNew(login, newBalance.toFixed(2));
 *
 * No key, no signature, no session. `{"cmd":"writeBet","login":42,"bet":"0.01",
 * "win":"1000000"}` posted by anyone credited a million to player 42.
 *
 * `/gold_api` and `/callback_evo` are the same shape. All three now require a
 * shared secret in a signed header, and refuse outright when none is
 * configured rather than falling open.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NONE OF THE THREE HAD DUPLICATE DETECTION
 *
 * No provider transaction id was recorded anywhere it could be checked, so
 * every retry settled again. `aggregator_transactions` (migration 017) is the
 * record, and its unique index is what enforces it — the row is written before
 * the money, inside the same transaction, so a duplicate rolls everything back.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ALL THREE WROTE THE BALANCE AS AN ABSOLUTE VALUE
 *
 *     UPDATE credits SET usdt = $1 WHERE uid = $2
 *
 * Read, compute in JavaScript, overwrite. Two concurrent settlements lose one
 * of themselves; a deposit landing mid-round is erased. Every movement goes
 * through the wallet, which applies a guarded delta.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `/callback_evo` ANSWERED BEFORE IT SETTLED
 *
 *     H.wait(1000).then(() => { SlotsRule.winner(user, bet, win, ...) });
 *     ...
 *     res.sendStatus(200);
 *
 * The provider was told "accepted" and the money moved a second later, in a
 * detached timer, with no error path. A restart inside that second lost the
 * settlement silently and the provider had already been told it succeeded.
 *
 * It also read `queue.client` BEFORE checking whether `queue` existed, so
 * settling for a player who was not currently connected over the socket threw
 * a TypeError inside a callback with no handler — a player who closed their
 * browser mid-round did not get paid.
 *
 * ── ON THE SOCKET BROADCAST ──────────────────────────────────────────────
 * Legacy pushed the new balance and the bet feed to the player's socket from
 * inside the settlement. Socket ownership is still an open architectural item,
 * so `onSettled` is the hook: it is called after the money is committed, it
 * cannot fail the settlement, and wiring it to the real transport is one
 * change in the container.
 */
class AggregatorsService {
  constructor({ models, db, config, logger, wallet, onSettled }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = wallet;
    this.onSettled = onSettled;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  asiaapi.net — /processRequest
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /processRequest
   *
   * Two commands on one endpoint: `getBalance` and `writeBet`.
   */
  async asia({ body, headers }) {
    try {
      if (!this.#authorise(AGGREGATOR.ASIA, headers)) {
        return { status: 'fail', error: ASIA_ERROR.UNAUTHORISED };
      }

      const { cmd, login } = body ?? {};
      if (!cmd || login === undefined || login === null || login === '') {
        return { status: 'fail', error: ASIA_ERROR.BAD_PARAMS };
      }

      const userId = this.#numericId(login);
      if (userId == null) return { status: 'fail', error: ASIA_ERROR.BAD_PARAMS };

      const balance = await this.#balanceOf(userId);
      // An unknown player is not a player with nothing. Legacy's helper returned
      // the string "0.00" for a missing row, so an unknown login looked real
      // and broke at the UPDATE instead of at the lookup.
      if (balance == null) return { status: 'fail', error: ASIA_ERROR.BAD_PARAMS };

      if (cmd === 'getBalance') {
        return {
          status: 'success',
          error: '',
          login: String(login),
          balance: this.#quote(balance),
          currency: ASIA_DISPLAY_CURRENCY,
        };
      }

      if (cmd !== 'writeBet') return { status: 'fail', error: ASIA_ERROR.UNKNOWN_CMD };

      const stake = this.#amount(body.bet);
      const payout = this.#amount(body.win);
      if (stake == null || payout == null) return { status: 'fail', error: ASIA_ERROR.BAD_PARAMS };

      // `tradeId` is the provider's id for the round. Without it the settlement
      // cannot be made idempotent, and a retry is a second payment.
      const tradeId = String(body.tradeId ?? '').trim();
      if (!tradeId) return { status: 'fail', error: ASIA_ERROR.BAD_PARAMS };

      const outcome = await this.#settle({
        aggregator: AGGREGATOR.ASIA,
        transactionId: tradeId,
        userId,
        memberAccount: String(login),
        stake,
        payout,
        gameCode: body.gameId != null ? String(body.gameId) : null,
        roundId: body.sessionId != null ? String(body.sessionId) : null,
        payload: body,
        balance,
      });

      if (outcome.insufficient) return { status: 'fail', error: ASIA_ERROR.NO_BALANCE };
      if (outcome.error) return { status: 'fail', error: ASIA_ERROR.INTERNAL };

      return {
        status: 'success',
        error: '',
        login: String(login),
        balance: this.#quote(outcome.balance ?? balance),
        currency: ASIA_DISPLAY_CURRENCY,
      };
    } catch (error) {
      this.logger?.error({ err: error }, 'asiaapi callback failed');
      return { status: 'fail', error: ASIA_ERROR.INTERNAL };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  nexusggreu.com — /gold_api
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy POST /gold_api */
  async nexus({ body, headers }) {
    try {
      if (!this.#authorise(AGGREGATOR.NEXUS, headers)) {
        return { status: 0, user_balance: 0, msg: NEXUS_MSG.UNAUTHORISED };
      }

      const method = String(body?.method ?? '');
      if (method === 'user_balance') return this.#nexusBalance(body);
      if (method === 'transaction') return this.#nexusTransaction(body);

      return { status: 0, msg: NEXUS_MSG.INVALID_METHOD };
    } catch (error) {
      this.logger?.error({ err: error }, 'nexus callback failed');
      return { status: 0, user_balance: 0, msg: NEXUS_MSG.SITE_ERROR };
    }
  }

  async #nexusBalance(body) {
    const userId = this.#numericId(body?.user_code);
    if (userId == null) return { status: 0, user_balance: 0, msg: NEXUS_MSG.INTERNAL };

    const balance = await this.#balanceOf(userId);
    if (balance == null) return { status: 0, user_balance: 0, msg: NEXUS_MSG.INTERNAL };

    return { status: 1, msg: NEXUS_MSG.SUCCESS, user_balance: Number(this.#quote(balance)) };
  }

  async #nexusTransaction(body) {
    const gameType = String(body?.game_type ?? '');
    if (!NEXUS_GAME_TYPES.includes(gameType) || !body?.[gameType]) {
      return { status: 0, msg: NEXUS_MSG.INVALID_GAME_TYPE };
    }

    const detail = body[gameType];
    const userId = this.#numericId(body.user_code);
    if (userId == null) return { status: 0, user_balance: 0, msg: NEXUS_MSG.INTERNAL };

    const stake = this.#amount(detail.bet_money);
    const payout = this.#amount(detail.win_money);
    if (stake == null || payout == null) return { status: 0, user_balance: 0, msg: NEXUS_MSG.INTERNAL };

    const txnId = String(detail.txn_id ?? '').trim();
    if (!txnId) return { status: 0, user_balance: 0, msg: NEXUS_MSG.INTERNAL };

    const balance = await this.#balanceOf(userId);
    if (balance == null) return { status: 0, user_balance: 0, msg: NEXUS_MSG.INTERNAL };

    const outcome = await this.#settle({
      aggregator: AGGREGATOR.NEXUS,
      transactionId: txnId,
      userId,
      memberAccount: String(body.user_code),
      stake,
      payout,
      gameCode: detail.game_code ?? null,
      providerCode: detail.provider_code ?? null,
      roundId: detail.txn_type ?? null,
      payload: body,
      balance,
    });

    if (outcome.insufficient) return { status: 0, msg: NEXUS_MSG.INSUFFICIENT };
    if (outcome.error) return { status: 0, user_balance: 0, msg: NEXUS_MSG.SITE_ERROR };

    return {
      status: 1,
      msg: NEXUS_MSG.SUCCESS,
      user_balance: Number(this.#quote(outcome.balance ?? balance)),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  EVO slots — /callback_evo
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /callback_evo
   *
   * The provider posts a flat form body with bracketed keys:
   *
   *     event[data][user][agregator_user_id]
   *     event[data][game][round][round_id]
   *     event[data][pay_for_action_this_round]
   *     event[data][game][round][win]
   *
   * (`agregator` is the provider's spelling, not a typo here.)
   *
   * Settled BEFORE responding, unlike legacy's detached one-second timer.
   */
  async evo({ body, headers }) {
    try {
      if (!this.#authorise(AGGREGATOR.EVO, headers)) return { ok: false, reason: 'unauthorised' };

      const field = (key) => body?.[`event[data]${key}`];

      const userId = this.#numericId(field('[user][agregator_user_id]'));
      const roundId = field('[game][round][round_id]');
      const stake = this.#amount(field('[pay_for_action_this_round]') ?? '0');
      const payout = this.#amount(field('[game][round][win]') ?? '0');

      if (userId == null || stake == null || payout == null) return { ok: false, reason: 'bad payload' };

      // The round id IS the idempotency key here; the provider sends nothing
      // else that identifies the settlement.
      const reference = String(roundId ?? '').trim();
      if (!reference) return { ok: false, reason: 'no round id' };

      // A round with no stake is a status ping, not a settlement.
      if (money.isZero(stake) && money.isZero(payout)) return { ok: true, skipped: true };

      const balance = await this.#balanceOf(userId);
      if (balance == null) return { ok: false, reason: 'unknown player' };

      const outcome = await this.#settle({
        aggregator: AGGREGATOR.EVO,
        transactionId: reference,
        userId,
        memberAccount: String(field('[user][agregator_user_id]')),
        stake,
        payout,
        gameCode: field('[game][game_id]') ?? null,
        roundId: reference,
        payload: body,
        balance,
      });

      if (outcome.insufficient) return { ok: false, reason: 'insufficient balance' };
      if (outcome.error) return { ok: false, reason: 'internal error' };

      return { ok: true, duplicate: Boolean(outcome.duplicate) };
    } catch (error) {
      this.logger?.error({ err: error }, 'evo callback failed');
      return { ok: false, reason: 'internal error' };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Shared
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Record the settlement, then make it — in one database transaction.
   *
   * All three aggregators settle through here, so there is one implementation
   * of "exactly once" to audit rather than three. The record goes in FIRST: if
   * the unique index rejects it we have seen this transaction, everything rolls
   * back, and nothing moves.
   */
  async #settle({
    aggregator,
    transactionId,
    userId,
    memberAccount,
    stake,
    payout,
    gameCode = null,
    providerCode = null,
    roundId = null,
    payload,
    balance,
  }) {
    // ONE signed delta covers all four shapes: a pure stake, a pure payout, a
    // settled round carrying both, and a push. Legacy branched on each and got
    // a different subset wrong in each provider.
    const delta = money.subtract(payout, stake);
    const action = !money.isZero(stake) && !money.isZero(payout) ? 'settle' : money.isZero(stake) ? 'win' : 'bet';

    try {
      const result = await this.db.transaction(async (transaction) => {
        const created = await this.models.AggregatorTransaction.create(
          {
            aggregator,
            transaction_id: transactionId,
            action,
            user_id: userId,
            member_account: memberAccount,
            currency: SETTLEMENT_CURRENCY,
            stake: money.toDecimalString(money.toMinor(stake)),
            payout: money.toDecimalString(money.toMinor(payout)),
            amount: money.toDecimalString(delta),
            game_code: gameCode,
            provider_code: providerCode,
            round_id: roundId,
            payload,
          },
          { transaction }
        );

        if (delta === 0n) return { balance };

        const isCredit = delta > 0n;
        const magnitude = money.toDecimalString(isCredit ? delta : -delta);

        const movement = await this.wallet[isCredit ? 'credit' : 'debit']({
          userId,
          currency: SETTLEMENT_CURRENCY,
          amount: magnitude,
          reason: isCredit ? 'BET_PAYOUT' : 'BET_STAKE',
          ref: { type: 'AGGREGATOR', id: `${aggregator}:${transactionId}` },
          description: `${aggregator} ${action} ${transactionId}`,
        });

        await this.models.AggregatorTransaction.update(
          { ledger_id: movement.ledgerId ?? null },
          { where: { id: created.id }, transaction }
        );

        return { balance: movement.newBalance };
      });

      /**
       * Told AFTER the money is committed, and never allowed to fail it.
       *
       * Legacy did the broadcast inside the settlement and threw when the
       * player was not connected, which is how a disconnected player stopped
       * getting paid.
       */
      this.#notify({ userId, aggregator, action, balance: result.balance });

      return result;
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') {
        this.logger?.info({ aggregator, transactionId }, 'Duplicate aggregator settlement ignored');
        return { duplicate: true, balance: await this.#balanceOf(userId) };
      }
      if (error?.code === 'WALLET_INSUFFICIENT_FUNDS' || error?.status === 402) return { insufficient: true };

      this.logger?.error({ err: error, aggregator, transactionId }, 'Aggregator settlement failed');
      return { error };
    }
  }

  #notify(event) {
    if (typeof this.onSettled !== 'function') return;
    try {
      this.onSettled(event);
    } catch (error) {
      this.logger?.warn({ err: error, ...event }, 'Settlement broadcast failed — the money is already committed');
    }
  }

  /**
   * Is this callback genuine?
   *
   * None of the three providers signs its callbacks, so what is verified is a
   * shared secret in a header — the minimum that turns "anyone who can reach the
   * port" into "someone who holds the key".
   *
   * An UNCONFIGURED aggregator refuses. Treating a missing secret as "no check
   * required" is how legacy behaved by omission, and it is the one outcome
   * worth ruling out explicitly.
   */
  #authorise(aggregator, headers) {
    const expected = this.config[`AGGREGATOR_${aggregator.toUpperCase()}_SECRET`];

    if (!expected) {
      this.logger?.error({ aggregator }, `AGGREGATOR_${aggregator.toUpperCase()}_SECRET is not configured — refusing`);
      return false;
    }

    const sent = headers?.['x-aggregator-key'] ?? headers?.['X-Aggregator-Key'];
    if (!sent) return false;

    return this.#safeEqual(sent, expected);
  }

  #safeEqual(a, b) {
    const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
    const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /** A positive integer player id, or null. Nothing else reaches a query. */
  #numericId(value) {
    const id = Number(String(value ?? '').trim());
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  /**
   * A non-negative decimal amount, or null.
   *
   * Legacy used `parseFloat`, which accepts `"12abc"` as 12 and yields `NaN`
   * for anything else — and `NaN` then flowed into the balance arithmetic and
   * out to `toFixed(2)` as the string `"NaN"`.
   */
  #amount(value) {
    const raw = String(value ?? '0').trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    try {
      return money.toDecimalString(money.toMinor(raw));
    } catch {
      return null;
    }
  }

  /** Two decimal places, as both providers quote balances. */
  #quote(amount) {
    return Number(money.toDecimalString(money.toMinor(amount ?? '0'))).toFixed(2);
  }

  async #balanceOf(userId) {
    try {
      const result = await this.wallet.balance(userId, SETTLEMENT_CURRENCY);
      const value = result == null ? null : typeof result === 'object' ? result.balance ?? null : result;
      return value == null ? null : money.toDecimalString(money.toMinor(value));
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }
}

module.exports = { AggregatorsService };
