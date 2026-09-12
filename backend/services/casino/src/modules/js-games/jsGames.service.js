'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const E = require('./jsGames.errors');
const { CODE, MESSAGE, V1_CURRENCIES, V2_CURRENCIES, V2_TYPE, RAKEBACK_RATE } = require('./jsGames.constants');

/**
 * The two jsGames integrations.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * v2's BET CALLBACK TOOK THE PLAYER'S NEW BALANCE FROM THE REQUEST BODY
 *
 *     const newBalance = Number(parseFloat(balance).toFixed(8));
 *     ...
 *     UPDATE credits SET ${currencyColumn} = $1 WHERE uid = $2
 *
 * No authentication, no signature, no session, no arithmetic. `POST` a user id
 * and a number and that became their balance.
 *
 * It was never exploitable, for one accidental reason: the INSERT above it went
 * to `game_transactions`, a table that has never existed, so the handler threw
 * and returned 500 before reaching the UPDATE. Migration 016 creates that
 * table — which is exactly why the balance is now computed from the movement
 * and the callback is signature-checked with the provider's own scheme.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NEITHER CALLBACK HAD DUPLICATE DETECTION
 *
 * `js_game_transactions` has no unique column, and the single
 * `ON CONFLICT (external_transaction_id)` in the codebase names a column with
 * no constraint behind it — a runtime error, not a guard. Every provider retry
 * was a second payment. Migration 016 adds the indexes; the record is written
 * before the money, inside the same transaction, so the index decides.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * v1 MOVED MONEY WITH NO RECORD AT ALL
 *
 * The handler had three branches — bet>0 & win=0, bet=0 & win>0, both zero —
 * and ran the balance UPDATE unconditionally afterwards. A message carrying a
 * bet AND a win, which is what a winning spin settled in one call looks like,
 * matched no branch: no row was inserted, and
 *
 *     UPDATE credits SET x = x - bet + win
 *
 * still ran. Money moved with nothing recorded anywhere. One signed delta here,
 * always recorded.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * v1 NEVER CHECKED THE BALANCE
 *
 * `x - bet + win` has no floor, so a bet larger than the balance left it
 * negative. Every movement goes through the wallet, which refuses.
 *
 * ── ON `users.rakeamount` ────────────────────────────────────────────────
 * Legacy accrued 0.2% of each stake onto that column from inside the v2
 * callback — and for INR it assigned the figure inside a query callback that
 * ran after the value had already been read, so INR players accrued nothing.
 * It is not written here: `users` belongs to user-service. Every stake now
 * leaves a ledger row, so the accrual is derivable, and `RAKEBACK_RATE` is
 * declared for whoever derives it.
 */
class JsGamesService {
  constructor({ models, db, config, logger, wallet, v1, v2 }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = wallet;
    this.v1 = v1;
    this.v2 = v2;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  v1 — huidu.bet
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /jsGames/game/launch
   *
   * `user_id` came from the request body with no authentication, so anyone
   * could open a session against any player. It comes from the token.
   */
  async launchV1({ userId, gameUid, currencyCode, language, homeUrl }) {
    if (!this.v1?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v1' });

    const settlement = V1_CURRENCIES[String(currencyCode).toUpperCase()];
    if (!settlement) throw E.UNSUPPORTED_CURRENCY({ currency: currencyCode });

    const game = await this.models.JsGames.findOne({
      where: { game_uid: gameUid, is_active: true },
      raw: true,
    });
    if (!game) throw E.GAME_NOT_FOUND({ gameUid });

    if (await this.#casinoLocked(userId)) throw E.CASINO_LOCKED({ userId });

    /**
     * The credit figure sent to the provider is the player's REAL balance.
     *
     * Legacy defaulted it to the string `'50'` and let the caller override it
     * from the body — so a game opened showing whatever number the request
     * asked for, and the seamless callback then settled against the real one.
     */
    const balance = await this.#balanceOf(userId, settlement);
    if (balance == null) throw E.GAME_NOT_FOUND({ userId });

    const response = await this.#upstream(() =>
      this.v1.call('/game/v1', {
        agency_uid: this.v1.agencyUid,
        member_account: this.v1.memberAccount(userId, String(currencyCode).toUpperCase()),
        game_uid: gameUid,
        timestamp: Date.now().toString(),
        credit_amount: balance,
        currency_code: String(currencyCode).toUpperCase(),
        language: language || 'en',
        home_url: homeUrl || this.config.JSGAMES_HOME_URL || undefined,
        callback_url: this.config.JSGAMES_CALLBACK_URL || undefined,
      })
    );

    const launchUrl = response?.payload?.game_launch_url ?? response?.game_launch_url;
    if (response?.code !== CODE.SUCCESS || !launchUrl) throw E.UPSTREAM_REJECTED({ code: response?.code });

    const sessionToken = crypto.randomBytes(16).toString('hex');
    await this.models.JsGameSessions.create({
      user_id: userId,
      game_uid: gameUid,
      session_token: sessionToken,
      launch_url: launchUrl,
    });

    return { gameLaunchUrl: launchUrl, sessionToken };
  }

  /**
   * @legacy POST /jsGames/game/bet-callback
   *
   * Always resolves, always in the provider's envelope. See the class note.
   */
  async betCallbackV1(body) {
    try {
      if (!this.v1?.configured) return this.#v1Error(CODE.MAINTENANCE);

      const payload = this.v1.decrypt(body?.payload);
      // A payload that does not decrypt was not produced with our key. That IS
      // the authentication for this integration.
      if (!payload) return this.#v1Error(CODE.PAYLOAD_ERROR);

      if (!this.#isFresh(payload.timestamp)) {
        this.logger?.warn({ serial: payload.serial_number }, 'REJECTED jsGames v1 callback: stale timestamp');
        return this.#v1Error(CODE.PAYLOAD_ERROR);
      }

      const serial = String(payload.serial_number ?? '');
      // Without an id the movement cannot be made idempotent, and a retry
      // becomes a second payment. Legacy accepted it and carried on.
      if (!serial) return this.#v1Error(CODE.BAD_PARAMETERS);

      const userId = this.v1.parseMemberAccount(payload.member_account);
      if (!userId) return this.#v1Error(CODE.BAD_PARAMETERS);

      const settlement = V1_CURRENCIES[String(payload.currency_code ?? '').toUpperCase()];
      if (!settlement) return this.#v1Error(CODE.UNSUPPORTED_CURRENCY);

      const bet = money.toMinor(String(payload.bet_amount ?? '0'));
      const win = money.toMinor(String(payload.win_amount ?? '0'));

      /**
       * ONE signed delta, for every combination.
       *
       * Legacy branched on three specific shapes and moved money in all four,
       * so a message carrying both a bet and a win settled with no record.
       */
      const delta = win - bet;
      const type = bet > 0n && win > 0n ? 'settle' : bet > 0n ? 'bet' : win > 0n ? 'win' : 'loss';

      const outcome = await this.#applyMovement({
        model: this.models.JsGameTransactions,
        where: { serial_number: serial },
        record: {
          user_id: userId,
          game_uid: payload.game_uid ?? null,
          transaction_type: type,
          amount: money.toDecimalString(delta),
          currency: settlement,
          transaction_status: 'processed',
          external_transaction_id: payload.game_round ?? null,
          serial_number: serial,
          additional_data: payload,
        },
        userId,
        currency: settlement,
        delta,
        refId: `v1:${serial}`,
      });

      if (outcome.duplicate) {
        this.logger?.info({ serial }, 'Duplicate jsGames v1 callback ignored');
      } else if (outcome.insufficient) {
        return this.#v1Error(CODE.INSUFFICIENT_BALANCE);
      } else if (outcome.error) {
        return this.#v1Error(CODE.SYSTEM_ERROR);
      }

      const balance = outcome.balance ?? (await this.#balanceOf(userId, settlement)) ?? '0';

      return {
        code: CODE.SUCCESS,
        msg: '',
        payload: this.v1.encrypt({ credit_amount: String(balance), timestamp: Date.now().toString() }),
      };
    } catch (error) {
      this.logger?.error({ err: error }, 'jsGames v1 callback failed');
      return this.#v1Error(CODE.SYSTEM_ERROR);
    }
  }

  /**
   * @legacy POST /jsGames/game/transfer
   *
   * Move credit between our wallet and the provider's.
   *
   * ── LEGACY GAVE THE MONEY AWAY ───────────────────────────────────────
   * It was unauthenticated, took `user_id` from the body, and told the provider
   * to credit that account — WITHOUT DEBITING OURS. `credits` was never
   * touched. A deposit here created balance at the provider out of nothing, and
   * it recorded the movement with the hard-coded currency `'USD'` regardless of
   * what was transferred.
   *
   * Our side moves first, and a failed transfer is refunded.
   */
  async transferV1({ userId, gameUid, amount, transferType, currencyCode, actor }) {
    if (!this.v1?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v1' });

    const settlement = V1_CURRENCIES[String(currencyCode).toUpperCase()];
    if (!settlement) throw E.UNSUPPORTED_CURRENCY({ currency: currencyCode });

    const magnitude = money.toDecimalString(money.toMinor(String(amount)));
    if (money.lt(magnitude, '0') || money.isZero(magnitude)) throw E.TRANSFER_AMOUNT_REQUIRED();

    const isDeposit = transferType === 'deposit';
    // Derived, not random: a retried transfer must not move money twice.
    const transferId = crypto
      .createHash('sha256')
      .update(`${userId}:${gameUid}:${transferType}:${magnitude}:${settlement}`)
      .digest('hex')
      .slice(0, 32);

    // Our side first. A deposit INTO the game takes money from the player here.
    const movement = await this.wallet[isDeposit ? 'debit' : 'credit']({
      userId,
      currency: settlement,
      amount: magnitude,
      reason: isDeposit ? 'TRANSFER_OUT' : 'TRANSFER_IN',
      ref: { type: 'JSGAMES_TRANSFER', id: transferId },
      description: `jsGames ${transferType}`,
    });

    try {
      const response = await this.v1.call('/game/v2', {
        agency_uid: this.v1.agencyUid,
        member_account: this.v1.memberAccount(userId, String(currencyCode).toUpperCase()),
        game_uid: gameUid,
        timestamp: Date.now().toString(),
        credit_amount: isDeposit ? magnitude : `-${magnitude}`,
        transfer_id: transferId,
      });

      if (response?.code !== CODE.SUCCESS) {
        const error = new Error(response?.msg || 'Transfer rejected');
        error.body = response;
        throw error;
      }

      await this.models.JsGameTransactions.create({
        user_id: userId,
        game_uid: gameUid,
        transaction_type: transferType,
        amount: magnitude,
        currency: settlement,
        transaction_status: 'completed',
        external_transaction_id: transferId,
        serial_number: transferId,
        ledger_id: movement.ledgerId ?? null,
      });

      this.logger?.info({ userId, transferType, magnitude, staffId: actor?.id }, 'jsGames transfer completed');
      return { transferId, amount: magnitude, currency: settlement, balance: movement.newBalance };
    } catch (error) {
      /**
       * The provider refused after we already moved. Put it back.
       *
       * A refund that itself fails is logged at `fatal` with everything needed
       * to settle by hand, and the ORIGINAL error is what the caller sees —
       * they need to know the transfer failed, not that the cleanup did.
       */
      try {
        await this.wallet[isDeposit ? 'credit' : 'debit']({
          userId,
          currency: settlement,
          amount: magnitude,
          reason: isDeposit ? 'TRANSFER_IN' : 'TRANSFER_OUT',
          ref: { type: 'JSGAMES_TRANSFER_REVERSAL', id: transferId },
          description: `jsGames ${transferType} reversal`,
        });
      } catch (refundError) {
        this.logger?.fatal(
          { err: refundError, userId, transferId, amount: magnitude, currency: settlement },
          'jsGames transfer failed AND its refund failed — NEEDS MANUAL RECONCILIATION'
        );
      }

      this.logger?.error({ err: error, userId, transferId }, 'jsGames transfer rejected, our side refunded');
      throw E.UPSTREAM_REJECTED({ transferId });
    }
  }

  /**
   * @legacy POST /jsGames/game/transactions
   *
   * Pull the provider's own transaction list, for reconciliation. Was
   * unauthenticated, so it dumped every player's activity to anyone who asked.
   */
  async transactionsV1({ fromDate, toDate, pageNo, pageSize }) {
    if (!this.v1?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v1' });

    return this.#upstream(() =>
      this.v1.call('/game/transaction/list', {
        agency_uid: this.v1.agencyUid,
        timestamp: Date.now().toString(),
        from_date: new Date(fromDate).getTime(),
        to_date: new Date(toDate).getTime(),
        page_no: pageNo,
        page_size: pageSize,
      })
    );
  }

  /** @legacy GET /jsGames/games */
  async listGamesV1({ vendor, page, per_page: perPage }) {
    const where = { is_active: true, ...(vendor ? { vendor } : {}) };

    const { rows, count } = await this.models.JsGames.findAndCountAll({
      where,
      order: [['id', 'ASC']],
      limit: perPage,
      offset: (page - 1) * perPage,
      raw: true,
    });

    const priority = vendor ? await this.#vendorPriority(vendor) : [];
    return { rows: priority.length ? this.#promote(rows, priority, page) : rows, total: count };
  }

  /** @legacy GET /jsGames/games/search */
  async searchGamesV1({ keyword, vendor, page, per_page: perPage }) {
    const term = String(keyword ?? '').trim();

    const where = {
      is_active: true,
      ...(vendor ? { vendor } : {}),
      ...(term
        ? {
            [Op.or]: [
              { game_name: { [Op.iLike]: `%${term}%` } },
              { vendor: { [Op.iLike]: `%${term}%` } },
              { game_type: { [Op.iLike]: `%${term}%` } },
            ],
          }
        : {}),
    };

    const { rows, count } = await this.models.JsGames.findAndCountAll({
      where,
      order: [['id', 'ASC']],
      limit: perPage,
      offset: (page - 1) * perPage,
      raw: true,
    });

    if (!term) return { rows, total: count };

    const lower = term.toLowerCase();
    const rank = (row) => {
      const name = String(row.game_name ?? '').toLowerCase();
      if (name === lower) return 0;
      if (name.startsWith(lower)) return 1;
      if (String(row.vendor ?? '').toLowerCase().startsWith(lower)) return 2;
      return 3;
    };

    return { rows: [...rows].sort((a, b) => rank(a) - rank(b)), total: count };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  v2 — games.ibitplay.com
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy POST /jsGamesv2/launch — `user_id` came from the body. */
  async launchV2({ userId, gameUid, currencyCode, language }) {
    if (!this.v2?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v2' });

    const settlement = V2_CURRENCIES[String(currencyCode).toUpperCase()];
    if (!settlement) throw E.UNSUPPORTED_CURRENCY({ currency: currencyCode });

    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'casino_locked', 'system_locked'],
      raw: true,
    });
    if (!user) throw E.GAME_NOT_FOUND({ userId });
    if (user.casino_locked || user.system_locked) throw E.CASINO_LOCKED({ userId });

    const balance = (await this.#balanceOf(userId, settlement)) ?? '0';

    const response = await this.#upstream(() =>
      this.v2.request('/launch', {
        method: 'POST',
        body: {
          game_uid: gameUid,
          user_id: String(userId),
          credit_amount: String(balance),
          currency_code: String(currencyCode).toUpperCase(),
          language: language || 'en',
          name: user.name,
        },
      })
    );

    const launchUrl = response?.data?.game_launch_url;
    const sessionToken = response?.data?.session_token;
    if (!launchUrl || !sessionToken) throw E.UPSTREAM_REJECTED({ gameUid });

    await this.models.GameSession.create({
      user_id: userId,
      game_uid: gameUid,
      session_token: sessionToken,
      launch_url: launchUrl,
    });

    return { gameLaunchUrl: launchUrl, sessionToken };
  }

  /**
   * @legacy POST /jsGamesv2/bet-callback
   *
   * The one that took the balance from the body. See the class note.
   */
  async betCallbackV2({ body, headers }) {
    try {
      /**
       * `verify` returns NULL on success and a reason string on failure, so
       * the check is explicit. `verify(...) ?? 'not configured'` reads well and
       * is wrong: `??` treats the null success as nullish and substitutes the
       * fallback, which refuses every genuine callback.
       */
      const refusal = this.v2 ? this.v2.verify({ body, headers }) : 'not configured';
      if (refusal) {
        this.logger?.warn({ refusal, userId: body?.user_id }, 'REJECTED jsGames v2 callback');
        return { success: false, error: 'Unauthorised' };
      }

      const userId = Number(body.user_id);
      if (!Number.isInteger(userId) || userId <= 0) return { success: false, error: 'Invalid payload' };

      const type = String(body.transaction_type ?? '').toLowerCase();
      if (!Object.values(V2_TYPE).includes(type)) return { success: false, error: 'Invalid transaction_type' };

      const settlement = V2_CURRENCIES[String(body.currency ?? '').toUpperCase()];
      if (!settlement) return { success: false, error: 'Unsupported currency' };

      /**
       * The idempotency key.
       *
       * Legacy defaulted it to the literal string `'unknown'`, which would make
       * every callback that omitted one collide with every other. A movement we
       * cannot identify is a movement we cannot safely retry, so it is refused.
       */
      const externalId = String(body.transaction_id ?? '').trim();
      if (!externalId || externalId === 'unknown') return { success: false, error: 'transaction_id is required' };

      /**
       * THE BALANCE IS COMPUTED, NOT ACCEPTED.
       *
       * `body.balance` is ignored entirely — it is the field that made this
       * endpoint "post a number, own that balance".
       */
      const magnitude = money.toMinor(String(body.amount ?? '0'));
      if (magnitude < 0n) return { success: false, error: 'amount must be non-negative' };
      const delta = type === V2_TYPE.WIN ? magnitude : -magnitude;

      const outcome = await this.#applyMovement({
        model: this.models.GameTransaction,
        where: { external_transaction_id: externalId },
        record: {
          user_id: userId,
          game_uid: body.game_uid ?? null,
          transaction_type: type,
          amount: money.toDecimalString(delta),
          currency: settlement,
          external_transaction_id: externalId,
          additional_data: body,
        },
        userId,
        currency: settlement,
        delta,
        refId: `v2:${externalId}`,
      });

      if (outcome.duplicate) {
        this.logger?.info({ externalId }, 'Duplicate jsGames v2 callback ignored');
      } else if (outcome.insufficient) {
        return { success: false, error: 'Insufficient balance' };
      } else if (outcome.error) {
        return { success: false, error: 'Server error' };
      }

      const balance = outcome.balance ?? (await this.#balanceOf(userId, settlement)) ?? '0';
      return { success: true, new_balance: String(balance) };
    } catch (error) {
      this.logger?.error({ err: error }, 'jsGames v2 callback failed');
      return { success: false, error: 'Server error' };
    }
  }

  /** @legacy GET /jsGamesv2/games */
  listGamesV2(query) {
    if (!this.v2?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v2' });
    return this.#upstream(() => this.v2.request('/games', { query }));
  }

  /** @legacy GET /jsGamesv2/games/search */
  searchGamesV2(query) {
    if (!this.v2?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v2' });
    return this.#upstream(() => this.v2.request('/games/search', { query }));
  }

  /**
   * @legacy GET /jsGamesv2/history?userid=
   *
   * The id came from the query on an unauthenticated route, so any player's
   * history was one request away. It comes from the token.
   */
  historyV2({ userId }) {
    if (!this.v2?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v2' });
    return this.#upstream(() => this.v2.request('/user/history', { query: { user_id: userId } }));
  }

  /** @legacy GET /jsGamesv2/historyAdmin */
  historyAllV2() {
    if (!this.v2?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v2' });
    return this.#upstream(() => this.v2.request('/user/historyToClient'));
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Shared
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Record the movement, then make it — in one database transaction.
   *
   * Both integrations settle through here, so there is one implementation of
   * "exactly once" to audit rather than two. If the unique index rejects the
   * record we have seen this transaction before, everything rolls back, and no
   * money moves.
   */
  async #applyMovement({ model, where, record, userId, currency, delta, refId }) {
    if (delta === 0n) {
      // Nothing to move, but the record still matters: it is what makes the
      // retry of a zero-value settlement a no-op instead of a fresh row.
      try {
        await model.create(record);
      } catch (error) {
        if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
        return { duplicate: true };
      }
      return {};
    }

    const isCredit = delta > 0n;
    const magnitude = money.toDecimalString(isCredit ? delta : -delta);

    try {
      return await this.db.transaction(async (transaction) => {
        const created = await model.create(record, { transaction });

        const movement = await this.wallet[isCredit ? 'credit' : 'debit']({
          userId,
          currency,
          amount: magnitude,
          reason: isCredit ? 'BET_PAYOUT' : 'BET_STAKE',
          ref: { type: 'JSGAMES', id: refId },
          description: `jsGames ${record.transaction_type} ${refId}`,
        });

        await model.update({ ledger_id: movement.ledgerId ?? null }, { where: { id: created.id }, transaction });

        return { balance: movement.newBalance };
      });
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') return { duplicate: true };
      if (error?.code === 'WALLET_INSUFFICIENT_FUNDS' || error?.status === 402) return { insufficient: true };

      this.logger?.error({ err: error, refId, where }, 'jsGames movement failed');
      return { error };
    }
  }

  /** The provider's envelope for a refusal. Never an HTTP error. */
  #v1Error(code) {
    return { code, msg: MESSAGE[code] ?? 'Unknown error', success: false };
  }

  /**
   * Within the allowed clock skew?
   *
   * The provider sends epoch milliseconds as a string. An ABSENT timestamp is
   * accepted, because v1's payload does not always carry one and the AES key
   * plus the unique serial number are what actually guard this path — an
   * unparseable one is not, because that is what a tampered value looks like.
   */
  #isFresh(timestamp) {
    const skew = Number(this.config.JSGAMES_MAX_SKEW_SECONDS ?? 300);
    if (skew <= 0 || timestamp === undefined || timestamp === null || timestamp === '') return true;

    const at = Number(timestamp);
    if (!Number.isFinite(at)) return false;

    return Math.abs(Date.now() - at) <= skew * 1000;
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

  /** The curated ordering for a vendor, if one is configured. */
  async #vendorPriority(vendor) {
    const row = await this.models.PrioritizedGames.findOne({ where: { vendor }, raw: true });
    if (!row?.game_ids) return [];
    return String(row.game_ids)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter(Number.isInteger);
  }

  /**
   * Float the curated games to the top of page 1.
   *
   * Legacy computed an `adjustedOffset` for later pages that could go negative
   * and was clamped to zero, which repeated the same rows. Priority applies to
   * page 1 only here, and later pages are the plain ordering — simpler, and it
   * cannot duplicate.
   */
  #promote(rows, priorityIds, page) {
    if (page !== 1) return rows;
    const rank = new Map(priorityIds.map((id, index) => [id, index]));
    return [...rows].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      return ra - rb || a.id - b.id;
    });
  }

  async #upstream(call) {
    try {
      return await call();
    } catch (error) {
      this.logger?.error({ err: error, status: error?.status }, 'jsGames upstream call failed');
      if (error?.status >= 400 && error.status < 500) throw E.UPSTREAM_REJECTED({ status: error.status });
      throw E.UPSTREAM_FAILED();
    }
  }
}

module.exports = { JsGamesService, RAKEBACK_RATE };
