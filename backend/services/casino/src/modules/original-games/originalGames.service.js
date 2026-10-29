'use strict';

const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { money, entitlements } = require('@ibitplay/common');

const E = require('./originalGames.errors');
const { sign } = require('./provider/client');
const { addChildGamePoints } = require('../js-games/pointLedger');
const {
  EXPONENT,
  ACTION,
  ERROR_CODE,
  MAX_SKEW_SECONDS,
  NONCE_TTL_SECONDS,
  WAGER_SOURCE,
  VALIDATION_PLAYER_ID,
} = require('./originalGames.constants');

/**
 * Original Games Aggregator — seamless wallet (integration guide §5).
 * The player's money stays with us; the aggregator calls balance / bet / win / rollback.
 *
 * Rules (from the guide):
 *   - every callback: valid HMAC signature, at most 60 s old, nonce never seen before
 *   - `transaction_id` is the dedupe key: a repeat gets the FIRST answer back (same balance, same operator_tx_id)
 *   - INSUFFICIENT_FUNDS debits nothing
 *   - rollback of an unknown id → 200, and that bet is refused if it turns up later
 *   - a second rollback of the same bet → 200 with the current balance
 *   - a rollback reverses the amount WE recorded, never the amount in the request
 *
 * The `og_transactions` row is written before the wallet moves, in one DB transaction, so the
 * unique index decides a race between two copies of the same callback.
 */
class OriginalGamesService {
  constructor({ db, models, config, logger, wallet, provider, games }) {
    this.db = db;
    this.models = models;
    this.config = config;
    this.logger = logger;
    this.wallet = wallet;
    this.provider = provider;
    this.games = games;
  }

  // ── Launch ───────────────────────────────────────────────────────────

  /** Sandbox keys open demo sessions only (guide §4). */
  get mode() {
    return this.config.OG_ENV === 'production' ? 'real' : 'demo';
  }

  async launch({ userId, gameCode, currency, device, language }) {
    if (!this.provider?.configured) throw E.NOT_CONFIGURED();
    if (!(await this.originalsOn())) throw E.DISABLED();
    const [game] = await this.#query('SELECT enabled FROM og_games WHERE code = :gameCode', { gameCode });
    if (game && !game.enabled) throw E.GAME_DISABLED({ gameCode });
    const code = String(currency).toUpperCase();
    if (!EXPONENT[code]) throw E.UNSUPPORTED_CURRENCY({ currency });

    const user = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'originals_locked', 'system_locked'],
      raw: true,
    });
    // Its own lock (migration 141): `casino_locked` covers provider casino only.
    if (user?.originals_locked || user?.system_locked) throw E.ORIGINALS_LOCKED({ userId });

    let response;
    try {
      response = await this.provider.request('POST', '/v1/sessions/launch', {
        idempotencyKey: crypto.randomUUID(),
        body: withoutEmpty({
          player: withoutEmpty({ id: String(userId), nickname: user?.name ? String(user.name).slice(0, 64) : undefined, language }),
          game_code: gameCode,
          currency: code,
          mode: this.mode,
          platform: device,
          return_url: this.config.OG_RETURN_URL,
          deposit_url: this.config.OG_DEPOSIT_URL,
          session_ttl_seconds: 3600,
        }),
      });
    } catch (error) {
      if (!error?.status) throw E.UPSTREAM_FAILED({ cause: error?.message });
      if (error.status === 503) throw E.MAINTENANCE({ code: error.code });
      // Any other 4xx (GAME_DISABLED, CURRENCY_* …) is a setup problem: show its code, don't retry.
      throw E.UPSTREAM_REJECTED({ status: error.status, code: error.code });
    }
    if (!response?.launch_url || !response?.session_id) throw E.UPSTREAM_REJECTED({ code: 'NO_LAUNCH_URL' });

    await this.#query(
      `INSERT INTO og_sessions (session_id, user_id, game_code, currency, mode)
       VALUES (:sessionId, :userId, :gameCode, :currency, :mode) ON CONFLICT (session_id) DO NOTHING`,
      { sessionId: response.session_id, userId: String(userId), gameCode, currency: code, mode: this.mode }
    );

    return { gameLaunchUrl: response.launch_url, sessionId: response.session_id, mode: this.mode };
  }

  // ── On/off switch and game list ──────────────────────────────────────

  /**
   * Originals are on only when BOTH are on: the owner's plan ("Originals (in-house)") and the site
   * admin's `siteconfig.originals`. Off = no list, no launch, no new bets; open rounds still settle.
   */
  async originalsOn() {
    if (!(await entitlements.isFlagEntitled('originals'))) return false;
    const [row] = await this.#query('SELECT originals FROM siteconfig LIMIT 1').catch(() => []);
    return row?.originals !== false;
  }

  /** The lobby's list from `og_games`; empty while Originals are off. */
  async listGames() {
    if (!(await this.originalsOn())) return [];
    const rows = await this.#query('SELECT code, name, data FROM og_games WHERE enabled ORDER BY position, code');
    return rows.map((row) => ({
      game_code: row.code,
      name: row.name,
      image: row.data?.image_url ?? row.data?.image ?? row.data?.thumbnail ?? null,
    }));
  }

  /** The admin's list: every catalogue game with its own on/off switch. */
  async adminGames() {
    const rows = await this.#query('SELECT code, name, enabled, data FROM og_games ORDER BY position, code');
    return rows.map((row) => ({
      gameCode: row.code,
      name: row.name,
      enabled: row.enabled,
      image: row.data?.image_url ?? row.data?.image ?? row.data?.thumbnail ?? null,
    }));
  }

  /** One Original on or off: off leaves the lobby and refuses a launch. */
  async setGameEnabled({ gameCode, enabled }) {
    const rows = await this.#query('UPDATE og_games SET enabled = :enabled WHERE code = :gameCode RETURNING code', { gameCode, enabled });
    if (!rows.length) throw E.GAME_NOT_FOUND({ gameCode });
    return { gameCode, enabled };
  }

  /**
   * rainbet: the lobby order, set in the admin — `codes` first to last. A code the catalogue does
   * not hold is ignored; games left out keep their place after the listed ones.
   */
  async setOrder(codes) {
    await this.db.transaction(async (transaction) => {
      for (const [position, code] of codes.entries()) {
        await this.#query('UPDATE og_games SET position = :position WHERE code = :code', { position, code }, transaction);
      }
      await this.#query(
        `UPDATE og_games SET position = :offset + position WHERE NOT (code = ANY(ARRAY[:codes]::text[]))`,
        { offset: codes.length, codes: codes.length ? codes : [''] },
        transaction
      );
    });
    return this.adminGames();
  }

  /** Replace `og_games` with the aggregator's `GET /v1/games` (scripts/sync-original-games.js). */
  async syncGames() {
    if (!this.provider?.configured) throw E.NOT_CONFIGURED();
    let response;
    try {
      response = await this.provider.request('GET', '/v1/games');
    } catch (error) {
      throw error?.status ? E.UPSTREAM_REJECTED({ status: error.status, code: error.code }) : E.UPSTREAM_FAILED({ cause: error?.message });
    }
    // shortcut: one page only — the guide does not say /v1/games paginates; add a cursor loop if `next_cursor` appears.
    const list = Array.isArray(response) ? response : response?.games ?? response?.data ?? response?.items ?? [];
    const games = list
      .map((game) => ({ code: String(game?.game_code ?? game?.code ?? ''), name: String(game?.name ?? game?.title ?? ''), data: game }))
      .filter((game) => game.code);
    if (!games.length) throw E.UPSTREAM_REJECTED({ code: 'EMPTY_CATALOGUE' });

    await this.db.transaction(async (transaction) => {
      // A game the aggregator no longer offers leaves the lobby.
      await this.#query('DELETE FROM og_games WHERE NOT (code = ANY(ARRAY[:codes]::text[]))', { codes: games.map((g) => g.code) }, transaction);
      // rainbet: a game already listed keeps the admin's position; a new one goes to the end.
      for (const game of games) {
        await this.#query(
          `INSERT INTO og_games (code, name, position, data, synced_at)
           VALUES (:code, :name, (SELECT COALESCE(MAX(position), -1) + 1 FROM og_games), CAST(:data AS jsonb), NOW())
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, synced_at = NOW()`,
          { code: game.code, name: game.name || game.code, data: JSON.stringify(game.data) },
          transaction
        );
      }
    });
    return { synced: games.length, codes: games.map((g) => g.code) };
  }

  // ── Wallet callbacks: always return { status, body }, never throw ──────

  async callback(action, { body, rawBody, headers, method, path, query }) {
    try {
      const refusal = await this.#verify({ rawBody, headers, method, path, query });
      if (refusal) return refusal;

      const currency = String(body?.currency ?? '');
      if (!EXPONENT[currency]) return this.#error(ERROR_CODE.CURRENCY_MISMATCH, { currency });

      const playerId = this.#playerId(body);
      if (!/^\d{1,18}$/.test(playerId)) return this.#error(ERROR_CODE.PLAYER_NOT_FOUND, { currency });
      const userId = Number(playerId);

      const balance = await this.#balanceOf(userId, currency);
      if (balance == null) return this.#error(ERROR_CODE.PLAYER_NOT_FOUND, { currency });

      const session = await this.#session(body.session_id);
      if (session && String(session.user_id) !== playerId) return this.#error(ERROR_CODE.SESSION_EXPIRED, { currency });
      if (session && session.currency !== currency) return this.#error(ERROR_CODE.CURRENCY_MISMATCH, { currency });

      const ctx = { body, userId, currency, balance };
      if (action === ACTION.BALANCE) return this.#ok(balance, currency);
      const handler = { [ACTION.BET]: () => this.#bet(ctx), [ACTION.WIN]: () => this.#win(ctx), [ACTION.ROLLBACK]: () => this.#rollback(ctx) }[action];
      if (!handler) return this.#error(ERROR_CODE.INTERNAL, { currency });
      const result = await handler();
      await this.#saveResponse(body.transaction_id, result.body);
      return result;
    } catch (error) {
      this.logger?.error({ err: error, action, txId: body?.transaction_id }, 'Original games callback failed');
      return this.#error(ERROR_CODE.INTERNAL, { currency: body?.currency });
    }
  }

  /** Their validation run (guide §9) sends a test player we never launched; it plays as OG_VALIDATION_USER_ID. */
  #playerId(body) {
    const sent = String(body?.player_id ?? '');
    const testUser = this.config.OG_VALIDATION_USER_ID;
    return sent === VALIDATION_PLAYER_ID && testUser ? String(testUser) : sent;
  }

  async #bet({ body, userId, currency, balance }) {
    const amount = this.#amount(body.amount, currency);
    const txId = String(body.transaction_id ?? '');
    if (amount == null || !txId) return this.#error(ERROR_CODE.INTERNAL, { currency });

    const seen = await this.#tx(txId);
    if (seen) return this.#replay(seen, currency);

    // Rolled back before it reached us (guide §5.4 rule 1): refuse it, nothing moves.
    if (await this.#rollbackOf(txId)) {
      this.logger?.warn({ txId, userId }, 'Original games bet arrived after its rollback — refused');
      return this.#error(ERROR_CODE.INTERNAL, { currency, balance });
    }

    const user = await this.models.Users.findByPk(userId, { attributes: ['originals_locked', 'system_locked'], raw: true });
    if (user?.originals_locked || user?.system_locked) return this.#error(ERROR_CODE.PLAYER_BLOCKED, { currency, balance });
    // Originals switched off: no new bets (open rounds still settle).
    if (!(await this.originalsOn())) return this.#error(ERROR_CODE.MAINTENANCE, { currency, balance });

    const outcome = await this.#applyMoney({ kind: 'bet', body, userId, currency, amount, balance, txId, isCredit: false });
    if (outcome.insufficient) return this.#error(ERROR_CODE.INSUFFICIENT_FUNDS, { currency, balance });

    // VIP / rakeback / affiliate wager counting.
    if (outcome.fresh && !money.isZero(amount) && this.games?.recordActivity) {
      await this.games.recordActivity({
        userId,
        gameRef: null,
        wagered: amount,
        currency,
        source: WAGER_SOURCE,
        ref: txId,
        category: 'originals',
        provider: 'BC Originals',
        // The game code — the bonus wager contribution is per game (crash 50%, mines 80% …).
        catalogueRef: body.game_code ?? null,
      });
    }
    return outcome.response;
  }

  async #win({ body, userId, currency, balance }) {
    const amount = this.#amount(body.amount, currency);
    const txId = String(body.transaction_id ?? '');
    if (amount == null || !txId) return this.#error(ERROR_CODE.INTERNAL, { currency });

    const seen = await this.#tx(txId);
    if (seen) return this.#replay(seen, currency);

    const outcome = await this.#applyMoney({ kind: 'win', body, userId, currency, amount, balance, txId, isCredit: true });
    return outcome.response;
  }

  async #rollback({ body, userId, currency, balance }) {
    const txId = String(body.transaction_id ?? '');
    const refId = String(body.reference_transaction_id ?? '');
    if (!txId || !refId) return this.#error(ERROR_CODE.INTERNAL, { currency });

    // Same rollback again, or the bet was already rolled back: 200 with the current balance.
    if (await this.#tx(txId)) return this.#ok(balance, currency);
    if (await this.#rollbackOf(refId)) return this.#ok(balance, currency);

    const original = await this.#tx(refId);
    if (!original || original.kind === 'rollback' || String(original.user_id) !== String(userId)) {
      // We never applied it: save a no-op so the bet is refused if it arrives later.
      await this.#insertOnce({ kind: 'rollback', status: 'noop', body, userId, currency, amount: '0', txId, refId, balanceAfter: balance });
      return this.#ok(balance, currency);
    }

    const amount = money.fromStored(original.amount);
    const isCredit = original.kind === 'bet'; // undo a bet = pay back; undo a win = take back
    const outcome = await this.#applyMoney({ kind: 'rollback', body, userId, currency, amount, balance, txId, refId, isCredit });

    if (outcome.insufficient) {
      // The player already spent the win. A retry won't fix it: acknowledge, record `unfunded`, alert an operator.
      await this.#insertOnce({ kind: 'rollback', status: 'unfunded', body, userId, currency, amount, txId, refId, balanceAfter: balance });
      this.logger?.error({ userId, refId, amount, currency }, 'Original games rollback could not be funded — NEEDS MANUAL RECONCILIATION');
      return this.#ok(balance, currency);
    }

    if (outcome.fresh && isCredit && this.games?.reverseActivity) {
      await this.games
        .reverseActivity({ userId, source: WAGER_SOURCE, ref: refId, outbox: true })
        .catch((error) => this.logger?.warn({ err: error, refId }, 'Wager reversal failed — the rollback stands'));
    }
    return outcome.duplicate ? this.#ok(balance, currency) : outcome.response;
  }

  /**
   * Move money once: save the row, then debit/credit the wallet, in one DB transaction.
   * Returns `{ fresh, response }`, `{ insufficient: true }`, or `{ duplicate, response }` when
   * another copy of the same callback won the race.
   */
  async #applyMoney({ kind, body, userId, currency, amount, balance, txId, refId = null, isCredit }) {
    const reason = { bet: 'BET_STAKE', win: 'BET_PAYOUT', rollback: 'BET_ROLLBACK' }[kind];
    // The player's statement reads "Arrow Bow bet", not the aggregator's transaction id.
    const game = money.isZero(amount) ? null : await this.#gameName(body.game_code);
    try {
      const { id, after, betId } = await this.db.transaction(async (transaction) => {
        const rowId = await this.#insert({ kind, status: 'applied', body, userId, currency, amount, txId, refId, balanceAfter: balance }, transaction);
        if (money.isZero(amount)) return { id: rowId, after: balance };
        const betId = await this.#roundBetId({ userId, body, refId, rowId }, transaction);

        const movement = await this.wallet[isCredit ? 'credit' : 'debit']({
          userId,
          currency,
          amount,
          reason,
          ref: { type: 'OG', id: txId },
          description: `${game} ${kind}`,
          gameType: body.game_code ?? undefined,
          betId,
        });
        const newBalance = money.toDecimalString(money.toMinorQuantised(String(movement.newBalance)));
        await this.#query('UPDATE og_transactions SET balance_after = :after WHERE id = :id', { after: newBalance, id: rowId }, transaction);
        return { id: rowId, after: newBalance, betId };
      });

      if (!money.isZero(amount)) await this.#writePoints({ userId, currency, amount, isCredit, txId, kind, body, betId });
      return { fresh: true, response: this.#ok(after, currency, { operator_tx_id: operatorTxId(id) }) };
    } catch (error) {
      if (isDuplicate(error)) {
        const seen = await this.#tx(txId);
        return { duplicate: true, response: seen ? this.#replay(seen, currency) : this.#ok(balance, currency) };
      }
      if (error?.code === 'WALLET_INSUFFICIENT_FUNDS' || error?.status === 402) return { insufficient: true };
      throw error;
    }
  }

  /** A repeat of a saved transaction: its ORIGINAL balance and `operator_tx_id`. */
  #replay(row, currency) {
    if (row.kind === 'rollback') return this.#ok(row.balance_after ?? '0', currency);
    return this.#ok(row.balance_after ?? '0', currency, { operator_tx_id: operatorTxId(row.id) });
  }

  // ── og_transactions ──────────────────────────────────────────────────

  async #insert({ kind, status, body, userId, currency, amount, txId, refId = null, balanceAfter }, transaction) {
    const [row] = await this.#query(
      `INSERT INTO og_transactions
         (transaction_id, kind, status, user_id, session_id, round_id, game_code, currency, amount,
          reference_transaction_id, balance_after, request_json)
       VALUES (:txId, :kind, :status, :userId, :sessionId, :roundId, :gameCode, :currency, :amount, :refId, :balanceAfter,
               CAST(:requestJson AS JSONB))
       RETURNING id`,
      {
        txId,
        kind,
        status,
        userId: String(userId),
        sessionId: body.session_id ?? null,
        roundId: body.round_id ?? null,
        gameCode: body.game_code ?? null,
        currency,
        amount,
        refId: refId ?? body.reference_transaction_id ?? null,
        balanceAfter,
        requestJson: JSON.stringify(body),
      },
      transaction
    );
    return row.id;
  }

  /** Our first answer to this transaction, kept on its row (a replay keeps the original). Never fails the callback. */
  async #saveResponse(txId, responseBody) {
    if (!txId) return;
    try {
      await this.db.sequelize.query(
        'UPDATE og_transactions SET response_json = CAST(:json AS JSONB) WHERE transaction_id = :txId AND response_json IS NULL',
        { replacements: { json: JSON.stringify(responseBody), txId: String(txId) } }
      );
    } catch (error) {
      this.logger?.warn({ err: error, txId }, 'Original games response_json not saved');
    }
  }

  /** Insert, but a row already saved by a parallel copy of the same callback is fine. */
  async #insertOnce(row) {
    await this.#insert(row).catch((error) => {
      if (!isDuplicate(error)) throw error;
    });
  }

  /** `og_games.name` for a game code; the code itself, or "Original game", when it is not listed. */
  async #gameName(code) {
    if (!code) return 'Original game';
    const [row] = await this.#query('SELECT name FROM og_games WHERE code = :code', { code: String(code) }).catch(() => []);
    return row?.name || String(code);
  }

    async #tx(txId) {
    const [row] = await this.#query('SELECT * FROM og_transactions WHERE transaction_id = :txId', { txId });
    return row ?? null;
  }

  /** Has a rollback for this bet/win already been saved? */
  async #rollbackOf(txId) {
    const [row] = await this.#query(
      `SELECT 1 FROM og_transactions WHERE kind = 'rollback' AND reference_transaction_id = :txId LIMIT 1`,
      { txId }
    );
    return Boolean(row);
  }

  // ── Signature check ──────────────────────────────────────────────────

  /** null = genuine, fresh and unseen; otherwise the refusal to send back. */
  async #verify({ rawBody, headers, method, path, query }) {
    if (!this.provider?.configured) {
      this.logger?.error('Original games credentials are not configured — refusing callbacks');
      return { status: 503, body: { status: 'ERROR', error_code: ERROR_CODE.MAINTENANCE } };
    }
    const timestamp = String(headers['x-timestamp'] ?? '');
    const nonce = String(headers['x-nonce'] ?? '');
    const sent = String(headers['x-signature'] ?? '');
    const expected = sign(this.provider.webhookSecret, { method, path, query, timestamp, nonce, body: rawBody ?? Buffer.alloc(0) });
    const reject = (why) => {
      this.logger?.warn({ why, path }, 'REJECTED original games callback');
      return { status: 401, body: { status: 'ERROR', error_code: why } };
    };

    if (!sent || !sameText(sent, expected)) return reject('INVALID_SIGNATURE');
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > MAX_SKEW_SECONDS) return reject('REQUEST_EXPIRED');
    if (nonce.length < 16) return reject('REPLAY_DETECTED');

    const fresh = await this.#query('INSERT INTO og_nonces (nonce) VALUES (:nonce) ON CONFLICT (nonce) DO NOTHING RETURNING nonce', { nonce });
    if (!fresh.length) return reject('REPLAY_DETECTED');
    // shortcut: pruned on ~1% of callbacks; move to a timer if og_nonces ever shows up in slow logs.
    if (Math.random() < 0.01) {
      await this.#query(`DELETE FROM og_nonces WHERE seen_at < NOW() - make_interval(secs => :ttl)`, { ttl: NONCE_TTL_SECONDS * 5 }).catch(() => {});
    }
    return null;
  }

  // ── Amounts: they send/receive integer minor units (paise, micro-USDT); our wallet keeps decimals ──

  /** Their minor units → our decimal string; null unless a non-negative integer. */
  #amount(value, currency) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return money.toDecimalString(BigInt(value) * 10n ** BigInt(8 - EXPONENT[currency]));
  }

  /** Our decimal → their minor units, rounded DOWN (never report more than the player has), never below 0. */
  #minor(balance, currency) {
    const scaled = money.toMinorQuantised(String(balance ?? '0')) / 10n ** BigInt(8 - EXPONENT[currency]);
    return Number(scaled < 0n ? 0n : scaled);
  }

  #ok(balance, currency, extra = {}) {
    return { status: 200, body: { status: 'OK', balance: this.#minor(balance, currency), currency, ...extra } };
  }

  /** A business refusal: still HTTP 200, with `status: "ERROR"` (guide §5.2). */
  #error(code, { currency, balance } = {}) {
    const body = { status: 'ERROR', error_code: code };
    if (balance != null && EXPONENT[currency]) body.balance = this.#minor(balance, currency);
    if (currency) body.currency = currency;
    return { status: 200, body };
  }

  // ── Player data ──────────────────────────────────────────────────────

  async #session(sessionId) {
    if (!sessionId) return null;
    const [row] = await this.#query('SELECT user_id, currency FROM og_sessions WHERE session_id = :sessionId', { sessionId: String(sessionId) });
    return row ?? null;
  }

  /** The player's wallet balance; null = no such player. */
  async #balanceOf(userId, currency) {
    try {
      const result = await this.wallet.balance(userId, currency);
      const value = result == null ? null : typeof result === 'object' ? result.balance ?? null : result;
      return value == null ? null : money.fromStored(String(value));
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  /** Agent player's point ledger (INR only). A direct player's row is written by the wallet's ledger trigger. */
  /**
   * The round as a number for the ledgers' BIGINT `bet_id`: the id of the round's first og_transactions row.
   * A rollback without `round_id` takes the round of the transaction it undoes; no round at all → this row.
   */
  async #roundBetId({ userId, body, refId, rowId }, transaction) {
    const [row] = await this.#query(
      `SELECT MIN(t.id) AS id FROM og_transactions t
        WHERE t.user_id = :userId
          AND t.round_id = COALESCE(:roundId, (SELECT r.round_id FROM og_transactions r WHERE r.transaction_id = :refId))`,
      { userId: String(userId), roundId: body.round_id ?? null, refId: refId ?? body.reference_transaction_id ?? null },
      transaction
    );
    return Number(row?.id ?? rowId);
  }

  async #writePoints({ userId, currency, amount, isCredit, txId, kind, body, betId }) {
    const sequelize = this.db.sequelize;
    const entry = {
      userId,
      delta: isCredit ? amount : money.toDecimalString(money.negate(amount)),
      entryRef: `og:${txId}`,
      gameType: body.game_code ?? null,
      remark: `Original games ${kind} ${txId}`,
      betId,
      category: 'ORIGINAL_GAME', // credits.original_game_pts, not the JS / GIS thirdparty_pts
    };
    try {
      if (currency === 'INR') await addChildGamePoints(sequelize, entry);
    } catch (error) {
      this.logger?.error({ err: error, txId, userId }, 'Original games point ledger write failed — all_point drift');
    }
  }

  #query(sql, replacements, transaction) {
    return this.db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
  }
}

const isDuplicate = (error) => error?.name === 'SequelizeUniqueConstraintError';

const operatorTxId = (id) => `og-${id}`;

/** Constant-time compare (hashing first makes both sides the same length). */
function sameText(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** Drop undefined / null / '' fields, so the launch body only carries what we have. */
function withoutEmpty(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

module.exports = { OriginalGamesService };
