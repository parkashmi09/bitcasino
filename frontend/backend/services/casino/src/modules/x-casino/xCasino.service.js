'use strict';

const crypto = require('node:crypto');
const { Op, literal } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./xCasino.errors');
const {
  COIN_COLUMNS,
  TRANSACTION_TYPE,
  CREDIT_TYPES,
  SESSION_TTL_MS,
  PROVIDER_DECIMALS,
} = require('./xCasino.constants');

/**
 * The XGaming / GamingHub360 integration.
 *
 * Every method that touches money does so inside one transaction with a
 * guarded update, and every provider transaction id is written before the
 * response goes out.
 */
class XCasinoService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Opening a game
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/casino/gamerun
   *
   * Open a session and hand back the URL to load.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE PLAYER COMES FROM THEIR TOKEN
   *
   * Legacy took `user_id` off the body on a route with no middleware, so a
   * session could be opened against any account and played with that player's
   * balance. It also took `coin` off the body and stored it in a column that
   * was later interpolated into an UPDATE — see the module header.
   *
   * `coin` is resolved through COIN_COLUMNS here, so an unknown one is refused
   * at the door rather than becoming SQL later.
   * ─────────────────────────────────────────────────────────────────────
   */
  async openGame({ userId, gameId, currency, mode, language, homeUrl, device, vendor, title }) {
    const coin = String(currency ?? '').toUpperCase();
    if (!COIN_COLUMNS[coin]) throw errors.UNSUPPORTED_COIN({ currency: coin });

    const player = await this.models.Users.findOne({
      where: { id: userId },
      attributes: ['id', 'status', 'casino_locked', 'system_locked'],
      raw: true,
    });
    if (!player) throw errors.PLAYER_NOT_FOUND({ userId });

    /**
     * A locked player cannot open a game.
     *
     * Legacy checked nothing here, so the lock routes — which the operator uses
     * when money is going missing through an account — did not stop the player
     * launching a casino game.
     */
    if (player.system_locked || player.casino_locked || player.status === 'closed') {
      throw errors.PLAYER_LOCKED({ userId });
    }

    /**
     * 32 bytes from `crypto.randomBytes`.
     *
     * Legacy's `generateSessionIdC()` is the platform's own generator; the
     * session id is what the provider presents to authenticate every
     * subsequent callback about this round, so it is a bearer token and is
     * generated as one. Migration 028 also makes `game_runs.session_id`
     * unique, which it was not.
     */
    const session = crypto.randomBytes(32).toString('hex');

    const baseUrl = this.#gameRunBaseUrl(vendor);
    const url = new URL('/', baseUrl);
    url.searchParams.set('mode', mode ?? 'real');
    url.searchParams.set('game_id', String(gameId));
    url.searchParams.set('session', session);
    url.searchParams.set('currency', coin);
    url.searchParams.set('language', language ?? 'en');
    url.searchParams.set('casino_id', String(this.config?.XCASINO_ID ?? ''));
    if (homeUrl) url.searchParams.set('home_url', homeUrl);
    url.searchParams.set('device', device ?? 'desktop');

    await this.models.GameRuns.create({
      game_id: gameId,
      user_id: userId,
      currency: coin,
      mode: mode ?? 'real',
      language: language ?? 'en',
      home_url: homeUrl ?? null,
      device: device ?? 'desktop',
      vendor: vendor ?? null,
      title: title ?? null,
      session_id: session,
      url: url.toString(),
      coin,
      created_at: new Date(),
    });

    this.logger?.info({ userId, gameId, vendor, coin }, 'Casino game session opened');

    return { gameRunUrl: url.toString(), session };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Provider callbacks
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/casino/authenticate
   *
   * "Who is this session?" — the provider's first call after the game loads.
   */
  async authenticate({ session }) {
    const run = await this.#session(session);
    const balance = await this.#balanceOf(run.user_id, run.coin);

    return {
      user_id: String(run.user_id),
      user_name: run.user_name ?? String(run.user_id),
      currency_code: run.coin,
      balance: this.#toProvider(balance),
      game_id: run.game_id,
      session_id: run.session_id,
    };
  }

  /**
   * @legacy POST /api/casino/balance
   * @legacy GET  /api/casino/casino-balance
   *
   * What the player holds, in the wallet this session plays on.
   */
  async balance({ session, userId, currencyCode }) {
    const run = await this.#session(session, userId);

    /**
     * The provider tells us which currency it thinks this is. If that
     * disagrees with the session's wallet, something is wrong and reporting
     * the wrong wallet's balance would be worse than an error — legacy
     * ignored `currency_code` entirely and answered from `game_runs.coin`
     * whatever the provider asked about.
     */
    if (currencyCode && String(currencyCode).toUpperCase() !== run.coin) {
      throw errors.CURRENCY_MISMATCH({ expected: run.coin, got: currencyCode });
    }

    const balance = await this.#balanceOf(run.user_id, run.coin);
    return { balance: this.#toProvider(balance), currency_code: run.coin };
  }

  /**
   * @legacy GET /api/casino/casino-balance
   *
   * The player's own balance, read from their token.
   *
   * Legacy's version took the account from a query parameter on an
   * unauthenticated route, so any player's casino balance was one URL away.
   */
  async balanceForPlayer({ userId, currency }) {
    const coin = String(currency ?? 'INR').toUpperCase();
    if (!COIN_COLUMNS[coin]) throw errors.UNSUPPORTED_COIN({ currency: coin });

    const balance = await this.#balanceOf(userId, coin);
    return { currency: coin, balance, formatted: this.#toProvider(balance) };
  }

  /**
   * @legacy POST /api/casino/changebalance
   *
   * ═════════════════════════════════════════════════════════════════════
   * THE MONEY MOVE
   *
   * Legacy, in order:
   *
   *   1. SELECT the balance                    (unlocked)
   *   2. compute the new balance in JavaScript (floats)
   *   3. check `updatedBalance < 0`            (against the value from step 1)
   *   4. UPDATE credits SET ${coin} = <absolute value>
   *   5. INSERT the transaction record         (into a table that did not exist)
   *
   * Every one of those five is a defect. The read is unlocked, so two
   * concurrent bets see the same balance; the write is absolute, so the second
   * erases the first — the player bets twice and pays once. The floor check is
   * on a stale read. The column name is interpolated from an unauthenticated
   * request body. And step 5 threw every time, AFTER the money had moved,
   * turning a completed bet into a 500 the provider then retried.
   *
   * Here: one transaction; the idempotency key written FIRST so a retry
   * collides rather than repeating; a guarded UPDATE whose row count decides
   * whether the player could afford it; exact minor units throughout.
   * ═════════════════════════════════════════════════════════════════════
   */
  async changeBalance({
    session,
    userId,
    transactionId,
    roundId,
    transactionType,
    amount,
    currencyCode,
    roundFinished,
    gameId,
    reason,
    transactionTimestamp,
  }) {
    const type = String(transactionType ?? '').toUpperCase();
    if (!Object.values(TRANSACTION_TYPE).includes(type)) {
      throw errors.UNKNOWN_TRANSACTION_TYPE({ transactionType });
    }

    /**
     * A retry is a normal event.
     *
     * Checked before anything else, so the common case costs one indexed read
     * and returns the answer the provider was already given. The UNIQUE
     * constraint below is what makes it correct under concurrency; this only
     * makes it quiet.
     */
    const existing = await this.models.TransactionsCasino.findOne({
      where: { transaction_id: transactionId },
      raw: true,
    });
    if (existing) {
      this.logger?.info({ transactionId, userId }, 'Casino transaction replayed — returning the original outcome');
      return {
        balance: this.#toProvider(existing.balance_after ?? '0'),
        currency_code: existing.currency_code,
        replayed: true,
      };
    }

    const run = await this.#session(session, userId);
    const column = COIN_COLUMNS[run.coin];
    if (!column) throw errors.UNSUPPORTED_COIN({ currency: run.coin });

    const minor = money.toMinor(amount ?? '0');
    if (minor < 0n) throw errors.NEGATIVE_AMOUNT({ amount });

    const isCredit = CREDIT_TYPES.includes(type);
    const decimal = money.toDecimalString(minor);

    return this.db.transaction(async (transaction) => {
      const before = await this.#balanceOf(run.user_id, run.coin, transaction);

      /**
       * The record FIRST, so a concurrent retry hits the unique constraint
       * before either of them can move money. Legacy wrote it last, into a
       * table that did not exist.
       */
      let record;
      try {
        record = await this.models.TransactionsCasino.create(
          {
            transaction_id: transactionId,
            round_id: roundId ?? null,
            user_id: run.user_id,
            session: run.session_id,
            transaction_type: type,
            amount: decimal,
            currency_code: currencyCode ?? run.coin,
            wallet: column,
            transaction_timestamp: transactionTimestamp ? new Date(transactionTimestamp) : new Date(),
            reason: reason ?? null,
            round_finished: Boolean(roundFinished),
            transaction_status: 'PENDING',
            balance_before: before,
            game_id: gameId != null ? String(gameId) : null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          { transaction }
        );
      } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') {
          // Two retries arrived at once and the other won the race.
          throw errors.DUPLICATE_TRANSACTION({ transactionId });
        }
        throw error;
      }

      if (isCredit) {
        await this.models.Credits.increment({ [column]: decimal }, { where: { uid: run.user_id }, transaction });
      } else {
        /**
         * The GUARDED debit.
         *
         * `WHERE <column> >= amount` — Postgres decides whether the player can
         * afford it, and the row count is the answer. Legacy compared a value
         * it had read earlier and then wrote an absolute number over whatever
         * was there.
         */
        const [affected] = await this.models.Credits.update(
          { [column]: literal(`"${column}" - ${decimal}`) },
          { where: { uid: run.user_id, [column]: { [Op.gte]: decimal } }, transaction }
        );

        if (!affected) {
          this.logger?.warn(
            { userId: String(run.user_id), transactionId, amount: decimal, wallet: column },
            'Casino BET refused — insufficient balance'
          );
          throw errors.INSUFFICIENT_FUNDS({ amount: decimal, currency: run.coin });
        }
      }

      const after = await this.#balanceOf(run.user_id, run.coin, transaction);

      await this.models.TransactionsCasino.update(
        { transaction_status: 'OK', balance_after: after, updated_at: new Date() },
        { where: { id: record.id }, transaction }
      );

      this.logger?.info(
        {
          userId: String(run.user_id),
          transactionId,
          roundId,
          type,
          amount: decimal,
          wallet: column,
          balanceAfter: after,
        },
        'Casino balance changed'
      );

      return { balance: this.#toProvider(after), currency_code: run.coin };
    });
  }

  /**
   * @legacy POST /api/casino/status
   *
   * "Did this transaction go through?" — asked when the provider's own request
   * timed out and it does not know the answer.
   *
   * This is the endpoint that makes a timeout recoverable, and in legacy it
   * read `transactionscasino` — the table that did not exist — so it answered
   * error 90 to every question. A provider that cannot get an answer here
   * resolves the ambiguity by retrying the money move.
   */
  async status({ transactionId, userId }) {
    const row = await this.models.TransactionsCasino.findOne({
      where: { transaction_id: transactionId, ...(userId ? { user_id: userId } : {}) },
      raw: true,
    });

    if (!row) return { transaction_id: transactionId, found: false };

    return {
      transaction_id: row.transaction_id,
      found: true,
      round_id: row.round_id,
      transaction_type: row.transaction_type,
      amount: this.#toProvider(row.amount),
      currency_code: row.currency_code,
      transaction_status: row.transaction_status,
      round_finished: Boolean(row.round_finished),
      balance: this.#toProvider(row.balance_after ?? '0'),
    };
  }

  /**
   * @legacy POST /api/casino/cancel
   *
   * Roll back a bet the provider is abandoning.
   *
   * Written as its own transaction with its own idempotency key, so cancelling
   * twice returns the first outcome rather than crediting twice.
   */
  async cancel({ transactionId, userId, cancelTransactionId }) {
    const original = await this.models.TransactionsCasino.findOne({
      where: { transaction_id: transactionId, ...(userId ? { user_id: userId } : {}) },
      raw: true,
    });

    if (!original) throw errors.TRANSACTION_NOT_FOUND({ transactionId });

    if (original.transaction_status === 'CANCELLED') {
      // Already done. Not an error — the provider is retrying.
      return { balance: this.#toProvider(original.balance_after ?? '0'), currency_code: original.currency_code };
    }

    if (original.transaction_type !== TRANSACTION_TYPE.BET) {
      // Only a stake can be handed back. Cancelling a WIN would mean clawing
      // money out of a wallet the player may already have spent from.
      throw errors.CANNOT_CANCEL({ transactionType: original.transaction_type });
    }

    const column = original.wallet;
    if (!column || !Object.values(COIN_COLUMNS).includes(column)) {
      throw errors.UNSUPPORTED_COIN({ currency: original.currency_code });
    }

    const reversalId = cancelTransactionId ?? `cancel:${transactionId}`;
    const decimal = money.toDecimalString(money.toMinor(original.amount ?? '0'));

    return this.db.transaction(async (transaction) => {
      try {
        await this.models.TransactionsCasino.create(
          {
            transaction_id: reversalId,
            round_id: original.round_id,
            user_id: original.user_id,
            session: original.session,
            transaction_type: TRANSACTION_TYPE.REFUND,
            amount: decimal,
            currency_code: original.currency_code,
            wallet: column,
            transaction_timestamp: new Date(),
            reason: `Cancellation of ${transactionId}`,
            round_finished: true,
            transaction_status: 'OK',
            balance_before: original.balance_after,
            created_at: new Date(),
            updated_at: new Date(),
          },
          { transaction }
        );
      } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') {
          throw errors.DUPLICATE_TRANSACTION({ transactionId: reversalId });
        }
        throw error;
      }

      await this.models.Credits.increment({ [column]: decimal }, { where: { uid: original.user_id }, transaction });

      const after = await this.#balanceOf(original.user_id, original.currency_code, transaction);

      await this.models.TransactionsCasino.update(
        { transaction_status: 'CANCELLED', updated_at: new Date() },
        { where: { id: original.id }, transaction }
      );
      await this.models.TransactionsCasino.update(
        { balance_after: after },
        { where: { transaction_id: reversalId }, transaction }
      );

      this.logger?.warn(
        { userId: String(original.user_id), transactionId, amount: decimal, wallet: column },
        'Casino bet CANCELLED and stake returned'
      );

      return { balance: this.#toProvider(after), currency_code: original.currency_code };
    });
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Resolve a session to the run it belongs to.
   *
   * When `userId` is supplied it must MATCH. Legacy queried
   * `WHERE session_id = $1 AND user_id = $2` in some handlers and
   * `WHERE session_id = $1` in others, so which check applied depended on
   * which callback arrived.
   */
  async #session(sessionId, userId) {
    if (!sessionId) throw errors.INVALID_SESSION();

    const run = await this.models.GameRuns.findOne({
      where: { session_id: sessionId, ...(userId != null ? { user_id: userId } : {}) },
      raw: true,
    });

    if (!run) throw errors.INVALID_SESSION({ session: String(sessionId).slice(0, 12) });

    /**
     * A session expires.
     *
     * Legacy's never did — a `game_runs` row from a year ago still
     * authenticated a balance change. `created_at` is nullable on that table,
     * so a row without one is treated as expired rather than eternal.
     */
    const createdAt = run.created_at ? new Date(run.created_at).getTime() : 0;
    if (Date.now() - createdAt > SESSION_TTL_MS) {
      throw errors.SESSION_EXPIRED({ session: String(sessionId).slice(0, 12) });
    }

    const player = await this.models.Users.findOne({
      where: { id: run.user_id },
      attributes: ['id', 'name'],
      raw: true,
    });
    if (!player) throw errors.PLAYER_NOT_FOUND({ userId: run.user_id });

    return { ...run, coin: String(run.coin ?? '').toUpperCase(), user_name: player.name };
  }

  async #balanceOf(userId, coin, transaction) {
    const column = COIN_COLUMNS[String(coin ?? '').toUpperCase()];
    if (!column) throw errors.UNSUPPORTED_COIN({ currency: coin });

    const row = await this.models.Credits.findOne({
      where: { uid: userId },
      attributes: [column],
      transaction,
      raw: true,
    });

    return money.toDecimalString(money.toMinor(row?.[column] ?? '0'));
  }

  /**
   * Money as the provider expects it: a number with two decimal places.
   *
   * The conversion happens ONCE, at the edge, from an exact decimal string.
   * Legacy carried floats end to end — the driver itself is configured with
   * `pg.types.setTypeParser(1700, parseFloat)`, so every numeric column in the
   * database arrives as a double before any handler sees it.
   */
  #toProvider(decimalString) {
    return Number(Number(decimalString).toFixed(PROVIDER_DECIMALS));
  }

  /**
   * Which host serves the game.
   *
   * Legacy hardcoded both:
   *
   *     const BASE_URL_CASINO = allowedVendors.includes(vendor)
   *       ? 'https://gamerun.thexgaming.com'
   *       : 'https://gamerun.gaminghub360.com';
   *
   * From configuration here, and an unconfigured deployment fails loudly at
   * the first launch rather than sending players to a host it was compiled
   * with.
   */
  #gameRunBaseUrl(vendor) {
    const primary = this.config?.XCASINO_GAMERUN_URL;
    const fallback = this.config?.XCASINO_GAMERUN_URL_ALT;

    const vendors = String(this.config?.XCASINO_PRIMARY_VENDORS ?? '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);

    const chosen = vendors.includes(String(vendor ?? '').toLowerCase()) ? primary : fallback ?? primary;

    if (!chosen) throw errors.NOT_CONFIGURED({ setting: 'XCASINO_GAMERUN_URL' });
    if (chosen.startsWith('http://') && !this.config?.XCASINO_ALLOW_INSECURE) {
      // A game-launch URL carries the session token in its query string.
      throw errors.NOT_CONFIGURED({ setting: 'XCASINO_GAMERUN_URL', reason: 'must be https' });
    }

    return chosen;
  }
}

module.exports = { XCasinoService };
