'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { money, sitePolicy } = require('@ibitplay/common');
const { agentPlayerError } = require('@ibitplay/auth');

const E = require('./gis.errors');
const { addChildGamePoints } = require('../js-games/pointLedger');
const { responseIdFor } = require('./responseId');
const { chosenAggregator, LIVE, PARKED } = require('../games/catalogueSwitch');
const {
  ERROR_CODE,
  ACTION,
  MONEY_ACTIONS,
  SETTLEMENT_CURRENCY,
  OUTBOUND_CURRENCY,
  CALLBACK_CURRENCY,
  BALANCE_SCALE,
} = require('./gis.constants');

/** gis_sessions.currency for an INR-wallet session played at Slotegrator in PKR. */
const INR_AS_PKR = 'INR>PKR';

/**
 * Slotegrator (GIS) — the second seamless wallet on the platform, and the one
 * with the most careful signature scheme and the least careful implementation.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. `bal` WAS AN UNDECLARED GLOBAL — BALANCES LEAKED BETWEEN PLAYERS
 *
 * `legacy/gis/controller.js` is not in strict mode, and line 922 reads:
 *
 *     bal = Big(cr.rows[0][col]);          // no `let`, no `const`
 *
 * The declaration that would have made it local is commented out twelve lines
 * below. So `bal` is a property of the module's global object, shared by every
 * request the process handles at once:
 *
 *     request A: bal = A's balance (100)
 *     request A: await ... (yields)
 *     request B: bal = B's balance (5000)
 *     request A: resumes, computes bal.plus(delta) → 4980
 *     request A: UPDATE credits SET usdt = 4980 WHERE uid = A
 *
 * Player A is now holding player B's money. Under any concurrency at all this
 * corrupts balances across accounts, and it does so silently — there is no
 * error, only a wrong number. Nothing here shares state between requests.
 *
 * 2. THE BALANCE WAS WRITTEN AS AN ABSOLUTE VALUE
 *
 *     const setBal = (uid, ccy, val) =>
 *       db.query(`UPDATE credits SET ${ccy} = $1 WHERE uid = $2`, [val, uid]);
 *
 *    Read, compute, overwrite. Two concurrent movements lose one of themselves
 *    even without defect 1. Every movement here is a guarded delta applied by
 *    the wallet, which the database arbitrates.
 *
 * 3. THE IDEMPOTENCY CHECK WAS A READ, NOT A CONSTRAINT
 *
 *    `SELECT ... WHERE transaction_id = $1` and then, much later, an INSERT.
 *    Two retries arriving together both read "not seen" and both paid. The
 *    record is written FIRST here, inside the same transaction as the money, so
 *    the unique index decides.
 *
 * 4. A ROLLBACK REVERSED WHATEVER THE REQUEST NAMED
 *
 *    `for (const tx of rollback_transactions) delta = delta.plus(Big(tx.amount))`
 *    — the figure came from the caller, and a rollback for a transaction we had
 *    never applied still moved money. Reversals use OUR recorded amount, and
 *    something we never applied is not reversed.
 *
 * 5. `X-Timestamp` WAS SIGNED BUT NEVER CHECKED
 *
 *    The signature is sound — HMAC-SHA1 over every parameter — but a captured
 *    request stayed valid forever. It must now be recent.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY NOTHING ON THE CALLBACK PATH THROWS
 *
 * Slotegrator requires HTTP 200 on every response, refusals included, carrying
 * `{error_code, error_description}`. A 4xx with our error envelope is a shape
 * their client cannot read, and it retries on anything it cannot read — an
 * infinite retry loop against a money endpoint. So `handleTransaction` returns
 * a shaped object and never rejects.
 *
 * ── ON `users.casino_gt` ─────────────────────────────────────────────────
 * Legacy mirrored net casino P&L onto that column from inside this handler, for
 * INR and PKR only, so an admin screen could read it without summing. It is not
 * written here: `users` belongs to user-service, and every movement now leaves a
 * ledger row with `source_service` set, so the figure is derivable. The admin
 * report that reads the column needs to derive it instead.
 */
/** `duplicate` is for this service's own bookkeeping, not the provider. */
function withoutInternal(outcome) {
  if (!outcome || typeof outcome !== 'object' || !('duplicate' in outcome)) return outcome;
  const { duplicate: _duplicate, ...rest } = outcome;
  return rest;
}

class GisService {
  constructor({ models, db, config, logger, wallet, provider, games, clients }) {
    this.clients = clients;
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = wallet;
    this.provider = provider;
    this.games = games;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  The wallet callback
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/gis/callback/transactions
   *
   * Always resolves. Always HTTP 200 at the route.
   */
  /**
   * `trusted`: a whitelabel copy settling a callback its parent verified and passed on
   * (casino modules/wl-hub — that route checks the parent's hub signature first).
   */
  async handleTransaction({ body, headers, trusted = false }) {
    try {
      const refusal = trusted && this.config.WHITELABEL_MODE ? null : this.#verify(body, headers);
      if (refusal) return refusal;

      const action = String(body.action ?? '');
      const playerId = String(body.player_id ?? '');
      const currency = String(body.currency ?? '').toUpperCase();

      if (!action || !playerId || !currency) {
        return this.#fail('action, player_id and currency are required');
      }

      // A whitelabel copy's player (`wl<id>_<player>`, written by this site at launch): the copy settles it.
      const wlPlayer = this.config.WHITELABEL_MODE ? null : whitelabelPlayer(playerId);
      if (wlPlayer) return await forwardGis({ db: this.db, config: this.config, logger: this.logger }, { ...wlPlayer, body }, (d) => this.#fail(d));

      // A non-numeric player id is not a player. Legacy logged this case and
      // then went on to query `credits` with it anyway, one branch later.
      if (!/^\d+$/.test(playerId)) return this.#fail('Player not found');

      // A PKR callback for a session launched from the INR wallet (owner's slotegrator_inr_as_pkr):
      // the money is INR, converted at `fx` PKR per INR both ways.
      const fx = currency === 'PKR' ? await this.#inrAsPkrRate(body.session_id) : null;
      const settlement = fx ? 'INR' : CALLBACK_CURRENCY[currency];
      if (!settlement) return this.#fail('Unsupported currency');
      if (fx && body.amount != null) body = { ...body, amount: money.toDecimalString(money.divide(String(body.amount), fx)) };
      const result = await this.#settle({ body, action, playerId, settlement });
      if (fx && result?.balance != null) result.balance = this.#quote(money.toDecimalString(money.multiply(result.balance, fx)));
      return result;
    } catch (error) {
      this.logger?.error({ err: error, action: body?.action }, 'GIS callback failed');
      return this.#fail('Unhandled internal error');
    }
  }

  /** PKR per INR for a session opened from the INR wallet in PKR; null for any other session. */
  async #inrAsPkrRate(sessionId) {
    if (!sessionId) return null;
    const session = await this.models.GisSessions.findOne({ where: { session_id: String(sessionId) }, attributes: ['currency'], raw: true });
    if (session?.currency !== INR_AS_PKR) return null;
    return this.#pkrPerInr();
  }

  /** PKR per INR at the site's exchange rates (usd_rate is USD per unit). */
  async #pkrPerInr() {
    const rows = await this.db.sequelize.query(
      "SELECT UPPER(currency) AS currency, usd_rate FROM exchangerate WHERE UPPER(currency) IN ('INR', 'PKR')",
      { type: this.db.sequelize.QueryTypes.SELECT }
    );
    const rate = Object.fromEntries(rows.map((r) => [r.currency, String(r.usd_rate)]));
    if (!rate.INR || !rate.PKR || money.isZero(rate.PKR)) throw E.UNSUPPORTED_CURRENCY({ currency: 'PKR' });
    return money.toDecimalString(money.divide(rate.INR, rate.PKR));
  }

  async #settle({ body, action, playerId, settlement }) {
    const userId = Number(playerId);
    const balance = await this.#balanceOf(userId, settlement);
    if (balance == null) return this.#fail('Player not found');

    if (action === ACTION.BALANCE) return this.#probe({ body, balance });

    const amount = money.toDecimalString(money.toMinor(String(body.amount ?? '0')));
    if (MONEY_ACTIONS.has(action) && money.lt(amount, '0')) {
      return this.#fail('amount must be non-negative');
    }

    switch (action) {
      case ACTION.BET:
        return await this.#bet({ body, userId, settlement, amount, balance });
      case ACTION.WIN:
        return withoutInternal(await this.#win({ body, userId, settlement, amount, balance }));
      case ACTION.REFUND:
        return withoutInternal(await this.#refund({ body, userId, settlement, amount, balance }));
      case ACTION.ROLLBACK:
        return await this.#rollback({ body, userId, settlement, balance });
      default:
        return this.#fail('Invalid action');
    }
  }

  /**
   * A balance probe, optionally asserting the player can cover an amount.
   *
   * Slotegrator tests this strictly before opening a game.
   */
  #probe({ body, balance }) {
    const asked = Object.prototype.hasOwnProperty.call(body, 'amount')
      ? money.toDecimalString(money.toMinor(String(body.amount)))
      : null;

    if (asked && !money.isZero(asked) && money.lt(balance, asked)) {
      return { error_code: ERROR_CODE.INSUFFICIENT_FUNDS, error_description: 'Not enough money to continue playing' };
    }

    return { balance: this.#quote(balance) };
  }

  async #bet({ body, userId, settlement, amount, balance }) {
    /**
     * An operator lock stops NEW play only. A win or a refund for a round that
     * is already in flight still settles — refusing those would leave the
     * provider holding a bet it cannot close out.
     */
    if (await this.#casinoLocked(userId)) {
      return { error_code: ERROR_CODE.INSUFFICIENT_FUNDS, error_description: 'Casino is locked for this account' };
    }

    const storageId = String(body.transaction_id ?? '');
    const outcome = await this.#apply({
      body,
      userId,
      settlement,
      amount,
      balance,
      storageId,
      isCredit: false,
      reason: 'BET_STAKE',
      insufficientIsAnError: true,
    });

    const { duplicate, ...response } = outcome;

    /**
     * The aggregator path never counted a stake: no `userwager`, no VIP XP, no
     * rakeback, no affiliate commission for anyone who only played Slotegrator
     * (or its sportsbook, which settles through this same callback). Counted
     * AFTER the movement is committed, only for a fresh one, and keyed on the
     * transaction id so a retry adds nothing on user-service's side either.
     * `recordActivity` swallows its own failures: the bet already stands.
     */
    if (!duplicate && !response.error_code && !money.isZero(amount) && this.games?.recordActivity) {
      await this.games.recordActivity({
        userId,
        gameRef: null,
        catalogueRef: body.game_uuid ?? null,
        wagered: amount,
        currency: settlement,
        source: 'gis',
        ref: storageId,
      });
    }

    return response;
  }

  async #win({ body, userId, settlement, amount, balance }) {
    // A plain win names its round: no stake from this player in that round, no payout.
    // Free spins and jackpots have no stake, and the provider may leave round_id out.
    const plainWin = !body.freespin_id && (body.type == null || body.type === 'win');
    if (plainWin && body.round_id != null && !money.isZero(amount)) {
      const bet = await this.models.GisTransactions.findOne({
        where: { user_id: userId, round_id: String(body.round_id), action: ACTION.BET },
        attributes: ['id'],
        raw: true,
      });
      if (!bet) {
        this.logger?.error({ playerId: userId, roundId: body.round_id, amount }, 'GIS win refused: no bet in this round');
        return this.#fail('No bet for this round');
      }
    }

    const response = await this.#apply({
      body,
      userId,
      settlement,
      amount,
      balance,
      storageId: String(body.transaction_id ?? ''),
      isCredit: true,
      reason: 'BET_PAYOUT',
    });
    if (body.freespin_id && !money.isZero(amount)) {
      this.#notifyFreeSpins(userId, {
        key: `gis:freespin-win:${body.transaction_id}`,
        title: 'Free spins win',
        template: '{amount} won with your free spins.',
        meta: { amount: String(amount), currency: settlement },
      });
    }
    return response;
  }

  /**
   * A free-spins event → the player's bell, Promotions tab (user-service categories.js `free_spins`).
   * Written straight to admin-service's inbox route, as user-service's notifyPlayer does; after the
   * money moved, never awaited, never fails the callback.
   */
  #notifyFreeSpins(userId, { key, title, template, meta = null }) {
    const text = meta ? template.replaceAll('{amount}', `${meta.amount} ${meta.currency}`) : template;
    void Promise.resolve()
      .then(() =>
        this.clients?.admin?.request('PUT', '/internal/admin/notifications/player', {
          body: { userId: Number(userId), kind: 'free_spins', title, body: text, key, data: { kind: 'free_spins', link: '/casino', ...(meta ? { meta, template } : {}) } },
        })
      )
      .catch((error) => this.logger?.warn({ err: error?.message, userId: String(userId), key }, 'Free spins notification not sent'));
  }

  /**
   * A refund of a bet we took.
   *
   * The stored id is derived from the BET being refunded, not from the
   * provider's id for the refund itself. Slotegrator retries a refund with a
   * fresh `transaction_id`, and legacy handled that with a second lookup keyed
   * on `bet_transaction_id` — a read, with the same race as every other read.
   * Deriving the key makes the unique index catch it instead.
   */
  async #refund({ body, userId, settlement, amount, balance }) {
    const betId = String(body.bet_transaction_id ?? '');
    if (!betId) return this.#fail('bet_transaction_id is required for a refund');

    const bet = await this.models.GisTransactions.findOne({
      where: { transaction_id: betId, action: ACTION.BET, user_id: userId, currency: settlement },
      raw: true,
    });

    /**
     * Nothing to refund. Recorded and acknowledged with the current balance,
     * because refusing would make the provider retry forever — but no money
     * moves, which is the part legacy also got right.
     */
    if (!bet) {
      this.logger?.warn({ betId, playerId: userId }, 'GIS refund names a bet we have no record of');
      return { balance: this.#quote(balance), transaction_id: this.#responseId(body.transaction_id) };
    }

    // Never more than the stake we took, whatever the request says.
    const stake = money.toDecimalString(money.abs(String(bet.amount ?? '0')));
    const refund = money.lt(stake, amount) ? stake : amount;

    const outcome = await this.#apply({
      body,
      userId,
      settlement,
      amount: refund,
      balance,
      storageId: `rf:${betId}`,
      isCredit: true,
      reason: 'BET_REFUND',
      reversedBet: betId,
    });

    /* The stake was counted under `gis:<bet id>` when it was taken; a refunded
       bet is no turnover. Only for a fresh refund that moved money — and only the
       refunded part: `amount` (settlement currency, the stake's currency) pro-rates the
       reversal in user-service, keyed by the provider's refund transaction id. A refund of
       the whole stake (or more) is a full reversal there. */
    if (!outcome.duplicate && !outcome.error_code && !outcome.insufficient && !money.isZero(refund)) {
      await this.#uncount(userId, betId, {
        amount: money.toDecimalString(money.abs(String(refund))),
        refundRef: body.transaction_id == null || body.transaction_id === '' ? `rf:${betId}` : String(body.transaction_id),
      });
    }
    return outcome;
  }

  /**
   * A refunded / rolled-back bet stops counting. Best-effort: never fails the callback.
   * A failed call is queued in `wager_reverse_outbox` (`outbox: true`) and retried by the
   * user-service worker — the reverse is idempotent per `(bet id, refund id)`.
   */
  async #uncount(userId, betId, { amount = null, refundRef = null } = {}) {
    if (!this.games?.reverseActivity) return;
    await this.games
      .reverseActivity({ userId, source: 'gis', ref: betId, amount, refundRef, outbox: true })
      .catch((error) => this.logger?.warn({ err: error, betId }, 'Wager reversal failed — the refund stands'));
  }

  /**
   * Undo transactions we already applied.
   *
   * Each entry is reversed from OUR record — its stored action and its stored
   * amount. An entry we have no record of is skipped, because reversing a
   * movement that never happened creates money.
   *
   * Each reversal carries a derived id (`rb:<original>`), so a retry with a
   * fresh `transaction_id` collapses onto the same rows. Legacy compared the
   * whole `rollback_transactions` array as a JSON STRING to spot that case,
   * which held only while the provider serialised it identically every time.
   */
  async #rollback({ body, userId, settlement, balance }) {
    const entries = Array.isArray(body.rollback_transactions) ? body.rollback_transactions : [];
    let current = balance;

    for (const entry of entries) {
      const originalId = String(entry?.transaction_id ?? '');
      if (!originalId) continue;

      const original = await this.models.GisTransactions.findOne({
        where: { transaction_id: originalId, user_id: userId, currency: settlement },
        raw: true,
      });

      if (!original) {
        this.logger?.warn({ originalId, playerId: userId }, 'GIS rollback names a transaction we never applied');
        continue;
      }

      const magnitude = money.toDecimalString(money.abs(String(original.amount ?? '0')));
      if (money.isZero(magnitude)) continue;

      // Reversing a bet gives money back; reversing a win or a refund takes it.
      const isCredit = original.action === ACTION.BET;

      const outcome = await this.#apply({
        body,
        userId,
        settlement,
        amount: magnitude,
        balance: current,
        storageId: `rb:${originalId}`,
        isCredit,
        reason: 'BET_ROLLBACK',
        action: ACTION.ROLLBACK,
        reverses: originalId,
        reversedBet: isCredit ? originalId : null,
      });

      /**
       * A reversal that cannot be funded.
       *
       * Rolling back a win the player has already spent means there is nothing
       * to take back. The wallet refuses to go negative, and it should — but
       * this is not something a retry fixes, and returning an error would make
       * the provider retry forever against a balance that is not coming back.
       *
       * So it is acknowledged, and logged at `error` with everything an
       * operator needs to settle it by hand. Silence here is how a shortfall
       * becomes invisible.
       */
      if (outcome.insufficient) {
        this.logger?.error(
          { playerId: userId, originalId, amount: magnitude, currency: settlement },
          'GIS rollback could not be funded — the player has already spent it. NEEDS MANUAL RECONCILIATION'
        );
        continue;
      }

      if (outcome.error_code) return outcome;
      current = outcome.rawBalance ?? current;

      // Rolling back a BET: it never happened, so its stake stops counting.
      if (isCredit && !outcome.duplicate) await this.#uncount(userId, originalId);
    }

    return {
      balance: this.#quote(current),
      transaction_id: this.#responseId(body.transaction_id),
      rollback_transactions: entries.map((t) => t?.transaction_id).filter(Boolean),
    };
  }

  /**
   * Apply exactly one movement.
   *
   * The `gis_transactions` row is written BEFORE the money, inside the same
   * database transaction. If the unique index on `transaction_id` rejects it,
   * we have seen this movement before, the whole thing rolls back, and nothing
   * moves. That ordering is what makes the guard a guard rather than a race.
   */
  async #apply({
    body,
    userId,
    settlement,
    amount,
    balance,
    storageId,
    isCredit,
    reason,
    action = body.action,
    reverses = null,
    reversedBet = null,
    insufficientIsAnError = false,
  }) {
    if (!storageId) return this.#fail('transaction_id is required');
    if (money.isZero(amount)) {
      return { balance: this.#quote(balance), transaction_id: this.#responseId(body.transaction_id) };
    }

    try {
      const result = await this.db.transaction(async (transaction) => {
        /**
         * A refund (`rf:`) and a rollback (`rb:`) of one bet have different ids, so the
         * unique index alone would let both pay. The bet's row lock queues them, and the
         * loser is treated as the duplicate it is.
         */
        if (reversedBet) {
          await this.models.GisTransactions.findOne({ where: { transaction_id: reversedBet }, attributes: ['id'], raw: true, lock: true, transaction });
          const done = await this.models.GisTransactions.findOne({
            where: { transaction_id: [`rf:${reversedBet}`, `rb:${reversedBet}`] },
            attributes: ['id'],
            raw: true,
            transaction,
          });
          if (done) throw Object.assign(new Error('Bet already reversed'), { name: 'SequelizeUniqueConstraintError' });
        }

        await this.models.GisTransactions.create(
          {
            user_id: userId,
            session_id: body.session_id ?? null,
            transaction_id: storageId,
            action,
            amount: isCredit ? amount : money.toDecimalString(money.negate(amount)),
            currency: settlement,
            game_uuid: body.game_uuid ?? null,
            type: body.type ?? null,
            freespin_id: body.freespin_id ?? null,
            quantity: body.quantity ?? null,
            round_id: body.round_id ?? null,
            finished: body.finished ?? null,
            transaction_datetime: body.transaction_datetime ? new Date(body.transaction_datetime) : null,
            bet_transaction_id: body.bet_transaction_id ?? reverses ?? null,
            rollback_transactions: body.rollback_transactions ?? null,
            provider_round_id: body.provider_round_id ?? null,
            /**
             * Seeded with the balance BEFORE the movement, and corrected below.
             *
             * The column is NOT NULL with no default, and the row has to exist
             * before the money moves — that ordering is what makes the unique
             * index a guard rather than a race. A real prior figure is a better
             * placeholder than a zero, and it is only visible if the movement
             * itself fails, in which case the whole transaction rolls back.
             */
            balance_after: balance,
          },
          { transaction }
        );

        const movement = await this.wallet[isCredit ? 'credit' : 'debit']({
          userId,
          currency: settlement,
          amount,
          reason,
          ref: { type: 'GIS', id: storageId },
          description: `${action} ${storageId}`,
          gameType: body.game_uuid ?? undefined,
        });

        await this.models.GisTransactions.update(
          { balance_after: movement.newBalance },
          { where: { transaction_id: storageId }, transaction }
        );

        return movement.newBalance;
      });

      await this.#writePoints({ userId, settlement, amount, isCredit, storageId, action, body, balanceAfter: result });

      return { balance: this.#quote(result), rawBalance: result, transaction_id: this.#responseId(body.transaction_id) };
    } catch (error) {
      /**
       * Already applied. The provider is retrying — acknowledged with the
       * CURRENT balance rather than the one stored beside the original row,
       * because other movements may have landed since and a stale figure is
       * what the player would see in the game.
       */
      if (error?.name === 'SequelizeUniqueConstraintError') {
        const now = await this.#balanceOf(userId, settlement);
        this.logger?.info({ storageId, action }, 'Duplicate GIS transaction ignored');
        return {
          balance: this.#quote(now ?? balance),
          rawBalance: now ?? balance,
          transaction_id: this.#responseId(body.transaction_id),
          duplicate: true,
        };
      }

      if (error?.code === 'WALLET_INSUFFICIENT_FUNDS' || error?.status === 402) {
        if (insufficientIsAnError) {
          return { error_code: ERROR_CODE.INSUFFICIENT_FUNDS, error_description: 'Not enough money to continue playing' };
        }
        // Reported rather than swallowed, so the caller can decide. A rollback
        // treats it as something an operator must settle; a bet treats it as a
        // refusal the provider understands.
        return {
          insufficient: true,
          balance: this.#quote(balance),
          rawBalance: balance,
          transaction_id: this.#responseId(body.transaction_id),
        };
      }

      throw error;
    }
  }

  // ── Callback plumbing ────────────────────────────────────────────────

  /**
   * Is this callback genuine and current?
   *
   * Returns null when it is, or the provider-shaped refusal when it is not.
   */
  #verify(body, headers) {
    if (!this.provider?.configured) {
      this.logger?.error('Slotegrator credentials are not configured — refusing callbacks');
      return this.#fail('Integration not configured');
    }

    const sent = headers['x-sign'] ?? headers['X-Sign'];
    const timestamp = headers['x-timestamp'] ?? headers['X-Timestamp'];

    const expected = this.provider.sign(body ?? {}, {
      'X-Merchant-Id': headers['x-merchant-id'] ?? headers['X-Merchant-Id'],
      'X-Timestamp': timestamp,
      'X-Nonce': headers['x-nonce'] ?? headers['X-Nonce'],
    });

    if (!sent || !this.#safeEqual(sent, expected)) {
      this.logger?.warn({ action: body?.action }, 'REJECTED GIS callback: signature mismatch');
      return this.#fail('Invalid X-Sign');
    }

    /**
     * `X-Timestamp` is inside the signature, so it cannot be edited without
     * breaking it — but legacy never checked that it was RECENT, which made a
     * captured request valid forever. It expires now.
     */
    if (!this.#isFresh(timestamp)) {
      this.logger?.warn({ action: body?.action, timestamp }, 'REJECTED GIS callback: stale X-Timestamp');
      return this.#fail('Invalid X-Sign');
    }

    return null;
  }

  #isFresh(timestamp) {
    const skew = Number(this.config.GIS_MAX_SKEW_SECONDS ?? 300);
    if (skew <= 0) return true;

    const seconds = Number(timestamp);
    // Unparseable fails closed — an absent or malformed timestamp is exactly
    // what a replayed capture would carry once the original expired.
    if (!Number.isFinite(seconds)) return false;

    return Math.abs(Date.now() / 1000 - seconds) <= skew;
  }

  #safeEqual(a, b) {
    const bufA = crypto.createHash('sha256').update(String(a ?? '')).digest();
    const bufB = crypto.createHash('sha256').update(String(b ?? '')).digest();
    return crypto.timingSafeEqual(bufA, bufB);
  }

  #fail(description) {
    return { error_code: ERROR_CODE.INTERNAL, error_description: description };
  }

  /** The transaction id we hand back. See `responseId.js`. */
  #responseId(externalId) {
    return responseIdFor(externalId);
  }

  /**
   * Balances are quoted to the provider with four decimal places, as a string.
   *
   * `toMinor` first: everything here travels as a decimal string, and
   * `toDecimalString` takes BigInt minor units. Handing it a string throws
   * "Cannot mix BigInt and other types" — which the callback's outer catch would
   * turn into a generic INTERNAL_ERROR, so the provider would see a failure
   * instead of a balance on every otherwise-successful call.
   */
  #quote(amount) {
    return Number(money.fromStored(amount ?? '0')).toFixed(BALANCE_SCALE);
  }

  /**
   * A player's balance, or null when there is no such player.
   *
   * The distinction matters: a missing player is `{balance: null}`, not a null
   * response. Checking the envelope rather than the figure inside it makes every
   * unknown player look real with a zero balance, and the provider then retries
   * a member that does not exist.
   */
  /**
   * Point ledger — JS games jaisa: agent ka child user → `point_ledger` (poori chain, sirf INR).
   * Direct user ki row wallet ka trigger likhta hai (migration 117). Paisa move ho chuka hota
   * hai; yahan sirf points likhte hain, alag transaction me. Fail ho to callback fail nahi hota
   * (provider ko 200 hi jaata hai) — sirf zor se log. `gis:<storageId>` se dobara nahi likhta.
   */
  async #writePoints({ userId, settlement, amount, isCredit, storageId, action, body, balanceAfter }) {
    const sequelize = this.models.Users.sequelize;
    const delta = isCredit ? amount : money.toDecimalString(money.negate(amount));
    const entry = {
      userId,
      delta,
      entryRef: `gis:${storageId}`,
      gameType: body.game_uuid ?? null,
      remark: `GIS ${action} ${storageId}`,
    };
    try {
      if (settlement === 'INR') await addChildGamePoints(sequelize, entry);
    } catch (error) {
      this.logger?.error({ err: error, storageId, userId }, 'GIS point ledger write failed — all_point drift');
    }
  }

  async #balanceOf(userId, currency) {
    try {
      const result = await this.wallet.balance(userId, currency);
      const value = result == null ? null : typeof result === 'object' ? result.balance ?? null : result;
      return value == null ? null : money.toDecimalString(money.toMinor(value));
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  async #casinoLocked(userId) {
    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'casino_locked', 'system_locked'],
      raw: true,
    });
    return Boolean(user?.casino_locked || user?.system_locked);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Launching a game
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/gis/games/init
   *
   * `player_id` came from the REQUEST BODY on an unauthenticated route, so
   * anyone could open a real-money session against any player's account and
   * play their balance. It comes from the token now, and there is no parameter
   * for it.
   */
  async launch({ userId, gameUuid, playerName, currency, device, returnUrl, language, lobbyData }) {
    this.#requireProvider();

    const settlement = SETTLEMENT_CURRENCY[String(currency).toUpperCase()];
    if (!settlement) throw E.UNSUPPORTED_CURRENCY({ currency });

    if (await this.#casinoLocked(userId)) throw E.CASINO_LOCKED({ userId });

    const sessionId = crypto.randomUUID();
    // Owner's switch: an INR game opens at Slotegrator in PKR; the session remembers it for the callbacks.
    const inPkr = settlement === 'INR' && (await sitePolicy.readPolicy(this.models, 'slotegrator_inr_as_pkr')) === 'on';

    await this.models.GisSessions.create({
      user_id: userId,
      session_id: sessionId,
      game_uuid: gameUuid,
      currency: inPkr ? INR_AS_PKR : settlement,
      device,
      return_url: returnUrl ?? null,
      language: language ?? null,
      lobby_data: lobbyData ?? null,
    });

    // Best-effort: a player's lobby history is not worth failing a launch over.
    try {
      await this.games.recordPlay({ userId, gameUuid });
    } catch (error) {
      this.logger?.warn({ err: error, userId, gameUuid }, 'Could not record recently-played');
    }

    const params = {
      game_uuid: gameUuid,
      player_id: userId,
      player_name: playerName,
      currency: inPkr ? 'PKR' : OUTBOUND_CURRENCY[settlement] ?? settlement,
      session_id: sessionId,
      device,
      // Configuration, not a literal. Legacy hard-coded
      // `https://addaplay.com/game-exit.html` here and ignored the caller's.
      return_url: returnUrl || this.config.GIS_RETURN_URL || undefined,
      language: language || undefined,
      lobby_data: lobbyData || undefined,
    };

    const response = await this.#upstream(() => this.provider.post('/games/init', this.#compact(params)));

    if (!response?.url) throw E.UPSTREAM_REJECTED({ gameUuid });
    return { url: response.url, sessionId };
  }

  /** @legacy POST /api/gis/games/init-demo */
  async launchDemo({ gameUuid, device, returnUrl, language }) {
    this.#requireProvider();

    const response = await this.#upstream(() =>
      this.provider.post(
        '/games/init-demo',
        this.#compact({
          game_uuid: gameUuid,
          device,
          return_url: returnUrl || this.config.GIS_RETURN_URL || undefined,
          language: language || undefined,
        })
      )
    );

    if (!response?.url) throw E.UPSTREAM_REJECTED({ gameUuid });
    return { url: response.url };
  }

  /** @legacy GET /api/gis/games/lobby */
  async lobby({ gameUuid, currency, technology }) {
    this.#requireProvider();

    const settlement = SETTLEMENT_CURRENCY[String(currency).toUpperCase()];
    if (!settlement) throw E.UNSUPPORTED_CURRENCY({ currency });

    return this.#upstream(() =>
      this.provider.get(
        '/games/lobby',
        this.#compact({
          game_uuid: gameUuid,
          currency: OUTBOUND_CURRENCY[settlement] ?? settlement,
          technology: technology || undefined,
        })
      )
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Upstream reads
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /api/gis/limits */
  limits() {
    return this.#upstream(() => this.provider.get('/limits'));
  }

  /** @legacy GET /api/gis/limits/freespin */
  freespinLimits() {
    return this.#upstream(() => this.provider.get('/limits/freespin'));
  }

  /** @legacy GET /api/gis/jackpots */
  jackpots() {
    return this.#upstream(() => this.provider.get('/jackpots'));
  }

  /** @legacy GET /api/gis/game-tags — 500 on every request; `pag` is not defined. */
  gameTags({ page, per_page: perPage }) {
    return this.#upstream(() => this.provider.get('/game-tags', { expand: 'category', page, per_page: perPage }));
  }

  /** @legacy GET /api/gis/freespins/bets */
  freespinBets({ gameUuid, currency }) {
    const settlement = SETTLEMENT_CURRENCY[String(currency).toUpperCase()];
    if (!settlement) throw E.UNSUPPORTED_CURRENCY({ currency });

    return this.#upstream(() =>
      this.provider.get('/freespins/bets', {
        game_uuid: gameUuid,
        currency: OUTBOUND_CURRENCY[settlement] ?? settlement,
      })
    );
  }

  /** @legacy GET /api/gis/self-validate */
  selfValidate() {
    return this.#upstream(() => this.provider.post('/self-validate', {}));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Freespin campaigns
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/gis/freespins/set
   *
   * `gis_freespins` NEVER EXISTED — this route has returned 500 since it was
   * written. Migration 016 creates it.
   */
  async setFreespin(input) {
    this.#requireProvider();

    if (!((input.betId && input.denomination) || input.totalBetId)) throw E.FREESPIN_BET_REQUIRED();

    const user = await this.models.Users.findByPk(input.playerId, { attributes: ['id', 'parent_staff_id'], raw: true });
    if (!user) throw E.USER_NOT_FOUND({ playerId: input.playerId });
    // No free spins / vouchers for an agent's player (user, 2026-10-18).
    if (user.parent_staff_id) throw agentPlayerError('promotions');

    /**
     * The provider is told FIRST, and only a confirmed campaign is stored.
     *
     * Legacy inserted the row and then called out, so a rejected campaign was
     * recorded locally as active — a player would see freespins that the game
     * server had never heard of.
     */
    await this.#upstream(() =>
      this.provider.post('/freespins/set', {
        player_id: input.playerId,
        player_name: input.playerName,
        currency: input.currency,
        quantity: input.quantity,
        valid_from: input.validFrom,
        valid_until: input.validUntil,
        freespin_id: input.freespinId,
        game_uuid: input.gameUuid,
        ...(input.betId ? { bet_id: input.betId } : {}),
        ...(input.denomination ? { denomination: input.denomination } : {}),
        ...(input.totalBetId ? { total_bet_id: input.totalBetId } : {}),
      })
    );

    const [row, created] = await this.models.GisFreespin.findOrCreate({
      where: { freespin_id: input.freespinId },
      defaults: {
        user_id: input.playerId,
        freespin_id: input.freespinId,
        game_uuid: input.gameUuid,
        currency: input.currency,
        quantity: input.quantity,
        quantity_left: input.quantity,
        valid_from: new Date(input.validFrom * 1000),
        valid_until: new Date(input.validUntil * 1000),
        bet_id: input.betId ?? null,
        total_bet_id: input.totalBetId ?? null,
        denomination: input.denomination ?? null,
        status: 'active',
      },
    });

    if (!created) throw E.FREESPIN_EXISTS({ freespinId: input.freespinId });
    this.#notifyFreeSpins(input.playerId, {
      key: `gis:freespin:${input.freespinId}`,
      title: 'Free spins added',
      template: `You got ${input.quantity} free spins. Open the game to play them.`,
    });
    return row.get({ plain: true });
  }

  /**
   * A PLAYER'S OWN ACTIVE FREESPIN CAMPAIGNS — new, no legacy equivalent.
   *
   * ═════════════════════════════════════════════════════════════════════
   * THE ONE READ THIS FEATURE NEVER HAD
   *
   * `gis_freespins` has had three routes over it since migration 016 and all
   * three are STAFF routes: grant one, fetch one by campaign id, cancel one.
   * There has never been a way for the player the campaign belongs to to find
   * out that it exists — which is why the front-end's Free Plays dialog has
   * rendered "Free Spins 0" over an empty state since it was built.
   *
   * ── IT DOES NOT TOUCH THE PROVIDER, DELIBERATELY ─────────────────────
   *
   * No `#requireProvider()`. Every other method in this section calls out to
   * Slotegrator and refuses without credentials, which on this delivery means
   * refusing always — no GIS keys are configured (see the deployment notes).
   * But the campaign rows are OURS: `setFreespin` writes them locally after
   * the provider confirms, and `getFreespin` already answers from the local
   * row first and only falls upstream when there is none. So a listing of what
   * we have recorded is answerable today, and gating it on a provider we do
   * not have would make a route that could work refuse for a reason that has
   * nothing to do with it.
   *
   * What that DOES mean is that `quantity_left` is only as fresh as the last
   * callback — the provider decrements it as spins are played. With no
   * provider it never moves. That is a data-staleness limit, not a correctness
   * one, and it is the same limit `getFreespin`'s local arm already has.
   *
   * ── ACTIVE, AND WITHIN ITS WINDOW ────────────────────────────────────
   *
   * `status: 'active'` excludes cancelled campaigns. The `valid_until` test is
   * the one that matters more: an expired campaign is not something a player
   * can act on, and showing it under a "Play Now" button would be the worst
   * kind of empty promise. `valid_from` is checked at the other end for the
   * same reason — a campaign scheduled for next week is not playable now.
   * Nulls pass both, since the columns are nullable and "no window" means "no
   * limit" rather than "never".
   *
   * ── THE GAME IS RESOLVED HERE AND NOT BY THE CALLER ──────────────────
   *
   * A campaign names a `game_uuid` and nothing else; the screen it feeds shows
   * the game's NAME under the campaign title. Resolving it client-side would
   * mean the client holding a copy of the catalogue, so the join is done here
   * across the same two tables `GamesService` uses — the aggregator catalogue
   * and the in-house list. On this delivery the aggregator side is empty (the
   * catalogue is the platform's biggest data gap), so in practice this
   * resolves in-house games and answers `null` for anything else. A null game
   * is rendered rather than dropped: the campaign is real even when we cannot
   * name what it is for.
   */
  async listMyFreespins({ userId }) {
    const now = new Date();

    const rows = await this.models.GisFreespin.findAll({
      where: {
        user_id: userId,
        status: 'active',
        is_canceled: 0,
        [Op.and]: [
          { [Op.or]: [{ valid_from: null }, { valid_from: { [Op.lte]: now } }] },
          { [Op.or]: [{ valid_until: null }, { valid_until: { [Op.gte]: now } }] },
        ],
      },
      order: [['id', 'DESC']],
      raw: true,
    });

    if (!rows.length) return { total: 0, freespins: [] };

    const byRef = await this.#resolveFreespinGames(rows.map((r) => r.game_uuid));

    return {
      total: rows.length,
      freespins: rows.map((row) => ({
        id: String(row.id),
        freespinId: row.freespin_id,
        gameUuid: row.game_uuid,
        game: byRef.get(row.game_uuid) ?? null,
        currency: row.currency,
        quantity: row.quantity,
        quantityLeft: row.quantity_left,
        /* The per-spin stake. Either `denomination` (paired with `bet_id`) or
           nothing, when the campaign was created with a `total_bet_id` and the
           provider owns the amount — never both, which is what `setFreespin`
           enforces on the way in. Null is reported rather than zeroed: "we do
           not know the stake" and "the stake is nothing" are different. */
        denomination: row.denomination,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
      })),
    };
  }

  /**
   * `game_uuid` -> `{uuid, name, provider, type, image}`, across the aggregator
   * catalogue and the in-house list.
   *
   * The same two-table lookup `GamesService.#resolveGames` does, and it is
   * duplicated rather than shared because the two live in different modules
   * and the alternative — a cross-module import between two services' internals
   * — is the coupling this codebase's module boundaries exist to prevent. If a
   * third caller appears, it belongs in `packages/db` beside the models.
   */
  async #resolveFreespinGames(refs) {
    const byRef = new Map();
    const unique = [...new Set(refs.filter(Boolean))];
    if (!unique.length) return byRef;

    const [aggregator, inHouse] = await Promise.all([
      this.models.Gisgamesnew.findAll({
        where: { uuid: { [Op.in]: unique } },
        attributes: ['uuid', 'name', 'provider', 'type', 'image'],
        raw: true,
      }),
      this.models.JsGames.findAll({ where: { game_uid: { [Op.in]: unique } }, raw: true }),
    ]);

    // In-house first, aggregator second — the aggregator row is the richer one
    // and wins if a reference somehow named a game in both.
    for (const g of inHouse) {
      byRef.set(g.game_uid, {
        uuid: g.game_uid,
        name: g.game_name,
        provider: g.vendor,
        type: g.game_type,
        image: g.game_icon,
      });
    }
    for (const g of aggregator) byRef.set(g.uuid, g);

    return byRef;
  }

  /** @legacy GET /api/gis/freespins/get */
  async getFreespin({ freespinId }) {
    const local = await this.models.GisFreespin.findOne({ where: { freespin_id: freespinId }, raw: true });
    if (local) return local;

    this.#requireProvider();
    const remote = await this.#upstream(() => this.provider.get('/freespins/get', { freespin_id: freespinId }));
    if (!remote) throw E.FREESPIN_NOT_FOUND({ freespinId });
    return remote;
  }

  /** @legacy POST /api/gis/freespins/cancel */
  async cancelFreespin({ freespinId }) {
    this.#requireProvider();

    const [changed] = await this.models.GisFreespin.update(
      { status: 'canceled', is_canceled: 1 },
      // Only an ACTIVE campaign is cancelled. Legacy updated unconditionally,
      // so cancelling twice reported success twice while the second call had
      // nothing to cancel.
      { where: { freespin_id: freespinId, status: 'active' } }
    );

    if (!changed) throw E.FREESPIN_NOT_FOUND({ freespinId });

    await this.#upstream(() => this.provider.post('/freespins/cancel', { freespin_id: freespinId }));
    return { freespinId, status: 'canceled' };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Free vouchers
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy POST /api/gis/freevouchers/set — `gis_freevouchers` never existed. */
  async setVoucher(input) {
    this.#requireProvider();

    const user = await this.models.Users.findByPk(input.playerId, { attributes: ['id', 'parent_staff_id'], raw: true });
    if (!user) throw E.USER_NOT_FOUND({ playerId: input.playerId });
    // No free spins / vouchers for an agent's player (user, 2026-10-18).
    if (user.parent_staff_id) throw agentPlayerError('promotions');

    await this.#upstream(() =>
      this.provider.post('/freevouchers/set', {
        player_id: input.playerId,
        title: input.title,
        currency: input.currency,
        initial_balance: input.initialBalance,
        max_winnings: input.maxWinnings,
        valid_until: input.validUntil,
        voucher_id: input.voucherId,
        table_ids: input.tableIds,
        ...(input.shortTerms ? { short_terms: input.shortTerms } : {}),
        ...(input.termsAndConds ? { terms_and_conds: input.termsAndConds } : {}),
      })
    );

    const [row, created] = await this.models.GisFreevoucher.findOrCreate({
      where: { voucher_id: input.voucherId },
      defaults: {
        user_id: input.playerId,
        voucher_id: input.voucherId,
        title: input.title,
        currency: input.currency,
        initial_balance: input.initialBalance,
        max_winnings: input.maxWinnings,
        playable: input.initialBalance,
        valid_until: new Date(input.validUntil * 1000),
        table_ids: input.tableIds.map(String),
        short_terms: input.shortTerms ?? null,
        terms_and_conds: input.termsAndConds ?? null,
        state: 'Active',
      },
    });

    if (!created) throw E.VOUCHER_EXISTS({ voucherId: input.voucherId });
    return row.get({ plain: true });
  }

  /** @legacy GET /api/gis/freevouchers/get */
  async getVoucher({ voucherId }) {
    const local = await this.models.GisFreevoucher.findOne({ where: { voucher_id: voucherId }, raw: true });
    if (local) return local;

    this.#requireProvider();
    const remote = await this.#upstream(() => this.provider.get('/freevouchers/get', { voucher_id: voucherId }));
    if (!remote) throw E.VOUCHER_NOT_FOUND({ voucherId });
    return remote;
  }

  /** @legacy POST /api/gis/freevouchers/cancel */
  async cancelVoucher({ voucherId, reason }) {
    this.#requireProvider();

    const [changed] = await this.models.GisFreevoucher.update(
      { state: reason },
      { where: { voucher_id: voucherId, state: 'Active' } }
    );

    if (!changed) throw E.VOUCHER_NOT_FOUND({ voucherId });

    await this.#upstream(() => this.provider.post('/freevouchers/cancel', { voucher_id: voucherId, reason }));
    return { voucherId, state: reason };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Catalogue sync
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /api/gis/sync/gamesnew
   *
   * Pulls the whole upstream catalogue into `gisgamesnew`.
   *
   * An UPSERT per game, never a truncate. `syncGames` in legacy opened with
   * `TRUNCATE TABLE gis_games RESTART IDENTITY`, so for the length of a sync —
   * hundreds of rate-limited pages, minutes — the catalogue that fed the lobby
   * was empty, and a sync that died half way left it that way.
   */
  async syncGames() {
    this.#requireProvider();

    const { items } = await this.provider.getAllPages('/games', {
      expand: 'tags,parameters,images,related_games',
    });

    // Slotegrator rows go to the lobby's table when Slotegrator is the owner's aggregator,
    // otherwise to the parked one — `games/catalogueSwitch.js`. A database before migration
    // 097 has neither the column nor the parked table: the plain upsert, as before.
    const switchReady = await this.#aggregatorSwitchReady();
    const table = switchReady && (await chosenAggregator(this.models)) !== 'slotegrator' ? PARKED : LIVE;

    let written = 0;
    let skipped = 0;

    for (const game of items) {
      if (!game?.uuid) {
        skipped += 1;
        continue;
      }

      const row = {
        uuid: String(game.uuid),
        name: game.name ?? null,
        provider: game.provider ?? null,
        provider_id: game.provider_id ?? null,
        type: game.type ?? null,
        image: game.image ?? null,
        technology: game.technology ?? null,
        has_lobby: game.has_lobby === 1 || game.has_lobby === true,
        is_mobile: game.is_mobile === 1 || game.is_mobile === true,
        has_freespins: game.has_freespins === 1 || game.has_freespins === true,
        freespin_valid_until_full_day:
          game.freespin_valid_until_full_day === 1 || game.freespin_valid_until_full_day === true,
        // The provider's own epoch-seconds stamp. It is a BIGINT holding their
        // data, not this row's modification time — see the model.
        updated_at: Number.isFinite(Number(game.updated_at)) ? Number(game.updated_at) : null,
        label: game.label ?? null,
        parameters: game.parameters ?? null,
        tags: game.tags ?? null,
        images: game.images ?? null,
      };

      if (switchReady) await this.#upsertSlotegratorGame(table, row);
      else await this.models.Gisgamesnew.upsert(row);

      written += 1;
    }

    // The same crawl names the providers, so the admin's provider list moves with the games.
    const { providers } = await this.#saveProviders(items);

    this.logger?.info({ written, skipped, table, providers }, 'Slotegrator game catalogue synced');
    return { written, skipped, fetched: items.length, table, providers };
  }

  /**
   * @legacy GET /api/gis/sync/providersnew
   *
   * ── THE TRUNCATE ERASED THE ENABLE FLAGS ─────────────────────────────
   * Legacy opened with `TRUNCATE TABLE gis_providers_new RESTART IDENTITY` and
   * re-inserted the provider names it found. `enabled` is on that table, and it
   * is what `PUT /admin/providers` writes — so every sync silently switched
   * every disabled provider back on. An operator who took a provider out of the
   * lobby got it back at the next sync, with nothing to say why.
   *
   * Providers are upserted by name here, so the flag survives. One that has
   * disappeared upstream is marked, not deleted, for the same reason.
   */
  async syncProviders() {
    this.#requireProvider();

    const { items } = await this.provider.getAllPages('/games', {
      expand: 'tags,parameters,images,related_games',
    });

    return this.#saveProviders(items);
  }

  /** Upsert each provider the crawl named into `gis_providers_new`; the `enabled` flags survive. */
  async #saveProviders(items) {
    const names = [
      ...new Set(items.map((g) => String(g?.provider ?? g?.label ?? '').trim()).filter(Boolean)),
    ].sort();

    for (const name of names) {
      await this.models.GisProvidersNew.findOrCreate({
        where: { name },
        defaults: { name, enabled: true },
      });
    }

    const stale = await this.models.GisProvidersNew.count({
      where: { name: { [Op.notIn]: names.length ? names : [''] } },
    });

    this.logger?.info({ providers: names.length, notSeenUpstream: stale }, 'Slotegrator providers synced');
    return { providers: names.length, notSeenUpstream: stale };
  }

  // ══════════════════════════════════════════════════════════════════════

  /** Is migration 097 (the aggregator column and the parked table) in this database? */
  async #aggregatorSwitchReady() {
    const [[row]] = await this.db.sequelize.query(`SELECT to_regclass('${PARKED}') IS NOT NULL AS ok`);
    return Boolean(row?.ok);
  }

  /**
   * One Slotegrator game into `table`, tagged `aggregator = 'slotegrator'`. Raw SQL because the
   * generated model has no `aggregator` column. A uuid already in the OTHER table (a game that
   * was parked or restored meanwhile) is updated there instead, so a game is never in both.
   */
  async #upsertSlotegratorGame(table, row) {
    const other = table === LIVE ? PARKED : LIVE;
    const json = (v) => (v == null ? null : JSON.stringify(v));
    const replacements = { ...row, parameters: json(row.parameters), tags: json(row.tags), images: json(row.images) };
    const set = `name = :name, provider = :provider, provider_id = :provider_id, type = :type, image = COALESCE(image, :image),
      technology = :technology, has_lobby = :has_lobby, is_mobile = :is_mobile, has_freespins = :has_freespins,
      freespin_valid_until_full_day = :freespin_valid_until_full_day, updated_at = :updated_at, label = :label,
      parameters = :parameters::jsonb, tags = :tags::jsonb, images = :images::jsonb, aggregator = 'slotegrator'`;

    const [, meta] = await this.db.sequelize.query(`UPDATE ${other} SET ${set} WHERE uuid = :uuid`, { replacements });
    if ((typeof meta === 'number' ? meta : meta?.rowCount ?? 0) > 0) return;

    await this.db.sequelize.query(
      `INSERT INTO ${table} (uuid, name, provider, provider_id, type, image, technology, has_lobby, is_mobile,
         has_freespins, freespin_valid_until_full_day, updated_at, label, parameters, tags, images, aggregator, created_at)
       VALUES (:uuid, :name, :provider, :provider_id, :type, :image, :technology, :has_lobby, :is_mobile,
         :has_freespins, :freespin_valid_until_full_day, :updated_at, :label, :parameters::jsonb, :tags::jsonb,
         :images::jsonb, 'slotegrator', NOW())
       ON CONFLICT (uuid) DO UPDATE SET ${set.replace(/COALESCE\(image, :image\)/, `COALESCE(${table}.image, :image)`)}`,
      { replacements }
    );
  }

  #requireProvider() {
    if (!this.provider?.configured) throw E.NOT_CONFIGURED();
  }

  /** Drop keys the provider wants omitted rather than sent empty. */
  #compact(params) {
    return Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
  }

  /** One place where an upstream failure becomes one of our errors. */
  async #upstream(call) {
    try {
      return await call();
    } catch (error) {
      this.logger?.error({ err: error, status: error?.status }, 'Slotegrator call failed');
      if (error?.status >= 400 && error.status < 500) throw E.UPSTREAM_REJECTED({ status: error.status });
      throw E.UPSTREAM_FAILED();
    }
  }
}

module.exports = { GisService };

// Required last: wl-hub/forward requires hubCredentials only, but keep the cycle-free order explicit.
const { whitelabelPlayer, forwardGis } = require('../wl-hub/forward');
