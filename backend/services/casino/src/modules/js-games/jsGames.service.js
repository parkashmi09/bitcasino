'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const E = require('./jsGames.errors');
const { addChildGamePoints } = require('./pointLedger');
/**
 * `recordPlay` and its trim live with the catalogue they are about. Imported
 * rather than duplicated — the alternative was a second copy of the "keep the
 * newest N" delete, which is exactly how two lists drift apart.
 */
const { GamesService } = require('../games/games.service');
const { ChallengeService } = require('../challenges/challenges.service');
const { catalogueConditions, assertVendorEntitled } = require('../games/gameEntitlement');
const {
  CODE,
  MESSAGE,
  V1_CURRENCIES,
  V2_CURRENCIES,
  V2_SETTLEMENT,
  V2_STAKED_TYPES,
  settlementType,
  RAKEBACK_RATE,
} = require('./jsGames.constants');

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
 * ran after the value had already been read, so INR players accrued nothing
 * while USDT players accrued it.
 *
 * The accrual happens here, but the WRITE does not: `users` belongs to
 * user-service, which already owns reading and claiming that balance. This
 * service computes the figure and posts it to
 * `POST /internal/user/rakeback/accrue`. Best effort, always after the
 * settlement has been accepted — a rakeback that cannot be recorded must never
 * be a reason a player's payout fails.
 */
class JsGamesService {
  constructor({ models, db, config, logger, wallet, clients, v1, v2 }) {
    this.models = models;
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.wallet = wallet;
    /** user-service, for the rakeback accrual and the USD rate behind it. */
    this.clients = clients ?? {};
    this.v1 = v1;
    this.v2 = v2;
    /* Same service, same models — a plain collaborator, not an HTTP hop. */
    this.games = new GamesService({ models, db, config, logger, clients: this.clients });
    /** rainbet: casino challenges, checked as a winning round settles. */
    this.challenges = new ChallengeService({ models, logger, clients: this.clients, wallet });
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

    /**
     * "Recently played" is a LAUNCH event, which is where the aggregator path
     * records it too (`gis.service.js`) — opening a game is what puts it in
     * the list, not winning at it. No wager yet, so only the play is written.
     */
    await this.games.recordActivity({ userId, gameRef: gameUid });

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

      /**
       * The wager counters, AFTER the movement has been accepted and only
       * when it was not a duplicate — a provider retrying a callback must not
       * count the same bet twice. `bet` and not `delta`: what was WAGERED is
       * the stake, independent of whether it won, which is what a wagering
       * requirement measures.
       */
      // rainbet: a winning round against the open challenges on its game (never awaited, never throws).
      if (!outcome.duplicate && bet > 0n && win > 0n) {
        void this.challenges.onSettled({
          userId,
          game: payload.game_uid ?? null,
          coin: settlement,
          amount: money.toDecimalString(bet),
          profit: money.toDecimalString(win - bet),
          betId: `v1:${serial}`,
        });
      }

      if (!outcome.duplicate && bet > 0n) {
        await this.games.recordActivity({
          userId,
          gameRef: payload.game_uid ?? null,
          wagered: money.toDecimalString(bet),
          currency: settlement,
          source: 'jsgames-v1',
          ref: serial,
        });
      }

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
    // The owner's plan (games/gameEntitlement.js): a switched-off vendor asked
    // for by name is refused; otherwise its rows (and a switched-off
    // category's) are simply not in the list.
    await assertVendorEntitled(vendor);
    const plan = await catalogueConditions();
    const where = { is_active: true, ...(vendor ? { vendor } : {}), ...(plan.length ? { [Op.and]: plan } : {}) };

    const priority = vendor ? await this.#vendorPriority(vendor) : [];

    if (!priority.length) {
      const { rows, count } = await this.models.JsGames.findAndCountAll({
        where,
        order: [['id', 'ASC']],
        limit: perPage,
        offset: (page - 1) * perPage,
        raw: true,
      });
      return { rows, total: count };
    }

    const total = await this.models.JsGames.count({ where });
    return { rows: await this.#pageWithPriority({ where, priority, page, perPage }), total };
  }

  /**
   * A page of the listing with the curated games ordered first.
   *
   * ── CURATION USED TO APPLY TO PAGE 1 AND ONLY WITHIN IT ─────────────────
   *
   * `#promote` sorted the rows the query had ALREADY returned. So a curated
   * game that happened to fall on page 3 of the catalogue stayed on page 3 —
   * the one place the ordering was supposed to move it away from — and an
   * operator who put six games at the top of a vendor's list saw them move only
   * if they were already inside the first `per_page` rows by id. On the lobby's
   * default page size the whole feature was invisible for any vendor with more
   * than fifty games, which is most of them.
   *
   * Two disjoint sets walked as if they were one list, which is the shape
   * `GamesService.#pageWithPriority` settled on for the aggregator side: the
   * curated block first, in the operator's order, then everything else by id
   * with the curated ones excluded so nothing appears twice.
   */
  async #pageWithPriority({ where, priority, page, perPage }) {
    const offset = (page - 1) * perPage;

    // Only curated games that survive the current filters hold a slot — a uid
    // for a game that has since been switched off must not leave a gap.
    const promotedRows = await this.models.JsGames.findAll({
      where: { ...where, game_uid: { [Op.in]: priority } },
      raw: true,
    });
    const byUid = new Map(promotedRows.map((row) => [row.game_uid, row]));
    const promoted = priority.map((uid) => byUid.get(uid)).filter(Boolean);

    const head = promoted.slice(offset, offset + perPage);
    if (head.length === perPage) return head;

    // How far into the remainder this page reaches: whatever the curated block
    // did not supply.
    const restOffset = Math.max(0, offset - promoted.length);
    const rest = await this.models.JsGames.findAll({
      where: { ...where, game_uid: { [Op.notIn]: priority } },
      order: [['id', 'ASC']],
      limit: perPage - head.length,
      offset: restOffset,
      raw: true,
    });

    return [...head, ...rest];
  }

  /** @legacy GET /jsGames/games/search */
  async searchGamesV1({ keyword, vendor, page, per_page: perPage }) {
    const term = String(keyword ?? '').trim();

    await assertVendorEntitled(vendor);
    const plan = await catalogueConditions();
    const where = {
      is_active: true,
      ...(vendor ? { vendor } : {}),
      ...(plan.length ? { [Op.and]: plan } : {}),
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

    /**
     * "Recently played" is a LAUNCH event — opening a game is what puts it in
     * the list, not winning at it. No wager yet, so only the play is written.
     *
     * `launchV1` has done this since it was ported and v2 did not, so a player
     * could open any number of provider games and their Recently Played page
     * stayed empty. The list is fed from `recordActivity` and nothing else
     * called it on this path.
     */
    await this.games.recordActivity({ userId, gameRef: gameUid });

    return { gameLaunchUrl: launchUrl, sessionToken };
  }

  /**
   * @legacy POST /jsGamesv2/v2/bet-callback
   *
   * The money path. See the class note for what it replaced.
   *
   * ── THE MESSAGE ──────────────────────────────────────────────────────
   *
   *   { user_id, game_uid, game_round, serial_number,
   *     bet_amount, win_amount, currency, timestamp }
   *
   * `game_round` is the idempotency key and `bet_amount`/`win_amount` are the
   * movement. There is NO `transaction_type` and NO `transaction_id` on the
   * wire — an earlier pass of this handler required both, which rejected every
   * genuine callback with `Invalid transaction_type` before it reached the
   * ledger. The type is derived from the amounts by `settlementType`.
   *
   * Both amounts may be negative: that is the provider reversing a round it
   * settled wrongly, and it is why the movement is one signed delta rather
   * than a debit branch and a credit branch.
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

      const settlement = V2_CURRENCIES[String(body.currency ?? '').toUpperCase()];
      if (!settlement) return { success: false, error: 'Unsupported currency' };

      /**
       * The idempotency key.
       *
       * Legacy defaulted the key to the literal string `'unknown'`, which would
       * make every callback that omitted one collide with every other. A
       * movement we cannot identify is a movement we cannot safely retry, so it
       * is refused rather than given a name.
       */
      const round = String(body.game_round ?? '').trim();
      if (!round || round === 'unknown') return { success: false, error: 'game_round is required' };

      /**
       * THE MOVEMENT IS COMPUTED, NOT ACCEPTED.
       *
       * Any `balance` on the body is ignored entirely — it is the field that
       * made this endpoint "post a number, own that balance".
       */
      let bet;
      let win;
      try {
        bet = money.toMinor(String(body.bet_amount ?? '0'));
        win = money.toMinor(String(body.win_amount ?? '0'));
      } catch {
        return { success: false, error: 'Invalid amounts' };
      }

      const type = settlementType(bet, win);
      const delta = win - bet;

      /**
       * A payout must belong to a round that was staked.
       *
       * Without this, `bet_amount: 0` plus any `win_amount` mints credit from
       * nothing — the signature is the only other thing standing in front of
       * it, and a signature proves who sent a message, not that the message
       * describes a round that happened.
       */
      if (type === V2_SETTLEMENT.WIN && this.#requireBetForWin()) {
        const staked = await this.models.GameTransaction.findOne({
          where: {
            user_id: userId,
            external_transaction_id: round,
            transaction_type: { [Op.in]: V2_STAKED_TYPES },
          },
          attributes: ['id'],
          raw: true,
        });
        if (!staked) {
          this.logger?.error({ userId, round }, 'REJECTED jsGames v2 callback: win with no matching bet');
          return { success: false, error: 'No matching bet for this round' };
        }
      }

      const catalogue = await this.#catalogueFacts(body.game_uid);

      const outcome = await this.#applyMovement({
        model: this.models.GameTransaction,
        where: { user_id: userId, external_transaction_id: round, transaction_type: type },
        record: {
          user_id: userId,
          game_uid: body.game_uid ?? null,
          transaction_type: type,
          amount: money.toDecimalString(delta),
          currency: settlement,
          external_transaction_id: round,
          serial_number: body.serial_number ? String(body.serial_number) : null,
          game_type: catalogue.gameType,
          game_name: catalogue.gameName,
          transaction_status: 'completed',
          additional_data: body,
        },
        userId,
        currency: settlement,
        delta,
        // Per player, like the row's unique key (migration 095): another
        // player's same round id is a different movement, not a replay.
        refId: `v2:${userId}:${round}:${type}`,
      });

      if (outcome.duplicate) {
        this.logger?.info({ round, type }, 'Duplicate jsGames v2 callback ignored');
        const balance = (await this.#balanceOf(userId, settlement)) ?? '0';
        return { success: true, duplicate: true, new_balance: String(balance) };
      }

      if (outcome.insufficient) {
        const balance = (await this.#balanceOf(userId, settlement)) ?? '0';
        return { success: false, error: 'Insufficient balance', new_balance: String(balance) };
      }

      if (outcome.error) return { success: false, error: 'Server error' };

      /**
       * The wager counters and the rakeback accrual, AFTER the movement has
       * been accepted and only when it was not a duplicate — a provider
       * retrying a callback must not count the same stake twice.
       *
       * `bet` and not `delta`: what was WAGERED is the stake, independent of
       * whether it won, which is what a wagering requirement measures.
       */
      /* The wager key is PER PLAYER, like the settlement row (migration 095):
         `wager_activity` is unique on (source, ref), so a bare round id let
         one player's stake swallow another's on the same round. A retried
         callback never reaches here — the settlement row's unique index
         answers it as a duplicate first — so the change of key cannot count
         an old round twice. */
      const wagerRef = `${userId}:${round}`;
      // rainbet: a v2 leg carries the round's own bet_amount / win_amount, so the win leg prices the
      // round's multiplier for the open challenges on its game (never awaited, never throws).
      if (win > 0n && bet > 0n) {
        void this.challenges.onSettled({
          userId,
          game: body.game_uid ?? null,
          coin: settlement,
          amount: money.toDecimalString(bet),
          profit: money.toDecimalString(win - bet),
          betId: `v2:${userId}:${round}`,
        });
      }
      if (bet > 0n) {
        // Counted in USD and rakeback accrued by user-service.
        await this.games.recordActivity({
          userId,
          gameRef: body.game_uid ?? null,
          wagered: money.toDecimalString(bet),
          currency: settlement,
          source: 'jsgames-v2',
          ref: wagerRef,
        });
      } else if (bet < 0n) {
        /* A negative bet is the provider taking back a stake it recorded
           wrongly: that part of the stake was never risked, so it stops
           counting (wager, rakeback) — a PARTIAL reversal of the
           `jsgames-v2:<player>:<round>` stake, keyed by this correction so a retried
           callback reverses once. Best-effort, queued in the outbox on failure. */
        await this.games
          .reverseActivity({
            userId,
            source: 'jsgames-v2',
            ref: wagerRef,
            amount: money.toDecimalString(-bet),
            refundRef: `${type}:${body.serial_number ?? round}`,
            outbox: true,
          })
          .catch((error) => this.logger?.warn({ err: error, round }, 'Wager reversal failed — the correction stands'));
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
    // The USER api, not the GAME api — a different base. See `requestUser`.
    return this.#upstream(() => this.v2.requestUser('/user/history', { query: { user_id: userId } }));
  }

  /** @legacy GET /jsGamesv2/historyAdmin */
  historyAllV2() {
    if (!this.v2?.configured) throw E.NOT_CONFIGURED({ provider: 'jsgames-v2' });
    return this.#upstream(() => this.v2.requestUser('/historyToClient'));
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
      const result = await this.db.transaction(async (transaction) => {
        const created = await model.create(record, { transaction });

        const movement = await this.wallet[isCredit ? 'credit' : 'debit']({
          userId,
          currency,
          amount: magnitude,
          reason: isCredit ? 'BET_PAYOUT' : 'BET_STAKE',
          ref: { type: 'JSGAMES', id: refId },
          description: `jsGames ${record.transaction_type} ${refId}`,
          gameType: record.game_type ?? record.game_uid ?? undefined,
        });

        await model.update({ ledger_id: movement.ledgerId ?? null }, { where: { id: created.id }, transaction });

        return { balance: movement.newBalance };
      });

      // Child user (agent ke neeche) ka point ledger — paisa move hone ke baad, alag transaction me.
      // Fail ho to paisa wapas nahi hota (wo user-service me ho chuka); sirf zor se log.
      if (currency === 'INR') {
        try {
          await addChildGamePoints(this.models.Users.sequelize, {
            userId,
            delta: money.toDecimalString(delta),
            entryRef: `jsgames:${refId}`,
            gameType: record.game_type ?? record.game_uid ?? null,
            remark: `jsGames ${record.transaction_type ?? ''} ${refId}`,
          });
        } catch (error) {
          this.logger?.error({ err: error, refId, userId }, 'jsGames point ledger write failed — all_point drift');
        }
      }

      return result;
    } catch (error) {
      if (error?.name === 'SequelizeUniqueConstraintError') return { duplicate: true };
      if (error?.code === 'WALLET_INSUFFICIENT_FUNDS' || error?.status === 402) return { insufficient: true };

      this.logger?.error({ err: error, refId, where }, 'jsGames movement failed');
      return { error };
    }
  }

  /**
   * Is the "a win must have a matching bet" rule on?
   *
   * On by default. It is switchable only because a provider MAY settle a bonus
   * round under a round id it never staked — if that is ever confirmed in
   * writing, `JSGAMES_REQUIRE_BET_FOR_WIN=false` turns it off. Until then,
   * leaving it on is what stops a signed message from minting credit.
   */
  #requireBetForWin() {
    return this.config?.JSGAMES_REQUIRE_BET_FOR_WIN !== false;
  }

  /**
   * `game_type` and `game_name`, copied onto the settlement row.
   *
   * Denormalised so bet history and the wager report read one table instead of
   * joining a catalogue a provider may retire a game from. A miss is not a
   * failure — an unknown game still settles, with nulls, because refusing the
   * money over a missing catalogue row would be the wrong trade.
   */
  async #catalogueFacts(gameUid) {
    if (!gameUid) return { gameType: null, gameName: null };
    try {
      const row = await this.models.JsGames.findOne({
        where: { game_uid: String(gameUid) },
        attributes: ['game_type', 'game_name'],
        raw: true,
      });
      return { gameType: row?.game_type ?? null, gameName: row?.game_name ?? null };
    } catch (error) {
      this.logger?.warn({ err: error, gameUid }, 'jsGames catalogue lookup failed — settling without it');
      return { gameType: null, gameName: null };
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

  /**
   * The curated ordering for a vendor, if one is configured.
   *
   * ── IT READS `js_game_curation`, AND IT RETURNS uids ───────────────────
   *
   * This read `prioritized_games`, whose `game_ids` is a CSV of `js_games.id`.
   * Those are surrogate keys in a table the provider sync RELOADS, so a sync
   * renumbered them and the curated list silently became a different set of
   * games — the order stayed valid-looking and pointed somewhere else.
   *
   * `game_uid` is the provider's own identifier and is what the launcher takes,
   * so it survives a re-sync. Migration 040 translates the existing rows across
   * and the admin panel writes uids; nothing writes `prioritized_games` now.
   */
  async #vendorPriority(vendor) {
    const row = await this.models.JsGameCuration.findOne(
      { where: { scope: 'vendor', key: vendor }, raw: true }
    );
    return String(row?.game_uids ?? '')
      .split(',')
      .map((uid) => uid.trim())
      .filter(Boolean);
  }

  async #upstream(call) {
    try {
      return await call();
    } catch (error) {
      this.logger?.error({ err: error, status: error?.status }, 'jsGames upstream call failed');
      /*
       * A REFUSAL IS A REFUSAL WHATEVER THE HTTP STATUS. v2 answers some refusals as
       * HTTP 200 with `{success: false, error: {code, message}}` (`XGamesApiClient#call`
       * throws those with `status: 200` and the provider's `upstreamCode`), and those
       * fell through to UPSTREAM_FAILED — "could not be reached" — for a provider that
       * had answered perfectly well. The provider's own code goes in `details` so the
       * refusal can be told apart (10004 currency/launch, 20004 signature, 20001 key).
       */
      const refused = (error?.status >= 400 && error.status < 500) || error?.body?.success === false;
      if (refused) {
        throw E.UPSTREAM_REJECTED({
          status: error.status,
          ...(error.upstreamCode !== undefined ? { upstreamCode: error.upstreamCode } : {}),
        });
      }
      throw E.UPSTREAM_FAILED();
    }
  }
}

module.exports = { JsGamesService, RAKEBACK_RATE };
