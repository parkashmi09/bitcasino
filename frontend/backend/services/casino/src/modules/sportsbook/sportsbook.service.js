'use strict';

const crypto = require('node:crypto');

const { Op } = require('sequelize');

const E = require('./sportsbook.errors');
const { SESSION_STATUS, PROVIDER_CURRENCY, SESSION_TTL_MS, PATHS, LIST_CACHE_MS } = require('./sportsbook.constants');
const { SETTLEMENT_CURRENCY } = require('../gis/gis.constants');

/**
 * Third-party sportsbook aggregator (Slotegrator betting).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NEVER MOUNTED
 *
 * `legacy/sportsbook/routes.js` exists, exports five routes, and is not
 * required anywhere in `legacy/index.js`. It has never served a request. That
 * makes this the one module in the port with no production behaviour to
 * preserve — nothing to be bug-compatible with, and no rows to migrate.
 *
 * It also means the code was never exercised, which shows.
 *
 * ── WHAT THE FIVE ENDPOINTS DID ──────────────────────────────────────────
 *
 *   GET  /sportsbooks              list the books. Fine, apart from being
 *                                  unauthenticated and uncached.
 *
 *   POST /sportsbooks/init         opened a REAL-MONEY session. `player_id`
 *                                  came from the request body. No auth.
 *
 *   GET  /sportsbooks/launch       fetched any URL the caller named and
 *                                  returned the body — a server-side request
 *                                  proxy. NOT PORTED; see the long note in
 *                                  `sportsbook.validators.js`.
 *
 *   POST /sportsbooks/logout       ended the session named by a token in the
 *                                  body. Any token.
 *
 *   POST /sportsbooks/refresh-token  called init again. It could not refresh
 *                                  anything: no session was ever stored.
 *
 * The common cause of the last three is that `session_id` was generated and
 * thrown away. Migration 031 stores it, which is what turns "end whatever
 * session this token names" into "end this player's session".
 *
 * ── WHY THIS LIVES IN THE CASINO SERVICE ─────────────────────────────────
 *
 * It is a sportsbook, so the sports service looks like the home. It is not.
 * The sports service owns OUR book — `"SportsBet"`, exposure, settlement, our
 * money and our liability. This module owns none of that: it launches a
 * third-party session and lets the provider's wallet callbacks move the
 * balance, exactly as the GIS, XGaming and nexus modules do. Those all live in
 * the casino service, and this shares their vendor, their signing scheme and
 * their client. Filing it by the sport it happens to cover rather than by what
 * it does would put a foreign wallet integration inside the service that owns
 * our own liability.
 * ═════════════════════════════════════════════════════════════════════════
 */
class SportsbookService {
  constructor({ models, logger, config, provider }) {
    this.models = models;
    this.logger = logger;
    this.config = config;
    /** A `SlotegratorClient`, built with the SPORTSBOOK merchant credentials. */
    this.provider = provider;

    /** The book list, briefly. See `LIST_CACHE_MS`. */
    this.listCache = null;
  }

  /**
   * @legacy GET /sportsbooks
   *
   * Cached. Legacy called upstream on every request, and the client calls this
   * on every page load — the provider rate-limits at roughly one call a second,
   * so a busy lobby spent its whole budget on a list that changes monthly.
   */
  async list({ now = Date.now() } = {}) {
    this.#requireProvider();

    if (this.listCache && this.listCache.until > now) return this.listCache.value;

    const response = await this.#upstream(() => this.provider.get(PATHS.LIST));
    const value = Array.isArray(response) ? response : (response?.items ?? response?.data ?? []);

    this.listCache = { value, until: now + LIST_CACHE_MS };
    return value;
  }

  /**
   * @legacy POST /sportsbooks/init
   *
   * `userId` comes from the token. That is the entire difference between this
   * and an endpoint anyone can point at anyone's account.
   */
  async init({ userId, sportsbookUuid, currency, language, returnUrl, ipAddress, now = new Date() }) {
    this.#requireProvider();

    const settlement = SETTLEMENT_CURRENCY[String(currency).toUpperCase()];
    if (!settlement) throw E.UNSUPPORTED_CURRENCY({ currency });

    const player = await this.models.Users.findByPk(userId, {
      attributes: ['id', 'name', 'email', 'casino_locked', 'system_locked'],
      raw: true,
    });

    if (!player) throw E.USER_NOT_FOUND({ userId });
    if (player.casino_locked || player.system_locked) throw E.SPORTSBOOK_LOCKED({ userId });

    /**
     * Sweep this player's abandoned sessions before checking for an open one.
     *
     * Without this the unique partial index turns a crashed browser into a
     * permanent lockout: the row stays `open` forever and every later `init`
     * gets SESSION_ALREADY_OPEN.
     */
    await this.#expireStale({ userId, now });

    const open = await this.models.SportsbookSession.findOne({
      where: { user_id: userId, sportsbook_uuid: sportsbookUuid, status: SESSION_STATUS.OPEN },
    });

    if (open) throw E.SESSION_ALREADY_OPEN({ sessionId: open.session_id });

    const sessionId = crypto.randomUUID();

    /**
     * The row is written BEFORE the provider is called.
     *
     * If the provider answers and we then fail to record it, the player has a
     * live session upstream that we have no record of — unclosable and
     * invisible. Writing first inverts the failure: a row with no session,
     * which the sweep above cleans up.
     */
    const session = await this.models.SportsbookSession.create({
      session_id: sessionId,
      user_id: userId,
      sportsbook_uuid: sportsbookUuid,
      currency: settlement,
      language: language ?? null,
      status: SESSION_STATUS.OPEN,
      ip_address: ipAddress ?? null,
      created_at: now,
      updated_at: now,
    });

    const params = this.#compact({
      sportsbook_uuid: sportsbookUuid,
      currency: PROVIDER_CURRENCY[settlement] ?? settlement,
      session_id: sessionId,
      player_id: String(userId),
      player_name: player.name || undefined,
      email: player.email || undefined,
      // Configuration, not the caller's word for it — but the caller may
      // override, which legacy allowed and is harmless: it is where the
      // PLAYER's browser goes when they close the book.
      return_url: returnUrl || this.config.SPORTSBOOK_RETURN_URL || undefined,
      language: language || undefined,
    });

    let response;
    try {
      response = await this.#upstream(() => this.provider.post(PATHS.INIT, params));
    } catch (error) {
      // The session never opened upstream. Close the row rather than leaving
      // it to the sweep, so the player can retry immediately.
      await session.update({ status: SESSION_STATUS.CLOSED, closed_at: now, updated_at: now });
      throw error;
    }

    if (!response?.url) {
      await session.update({ status: SESSION_STATUS.CLOSED, closed_at: now, updated_at: now });
      throw E.UPSTREAM_REJECTED({ sportsbookUuid });
    }

    await session.update({
      token: response.token ?? null,
      launch_url: response.url,
      updated_at: now,
    });

    return { sessionId, url: response.url, token: response.token ?? null };
  }

  /**
   * @legacy POST /sportsbooks/refresh-token
   *
   * Reads the session, checks it is the caller's, and asks the provider for a
   * fresh token on the SAME session id.
   *
   * Legacy generated a new session id and called init — so "refresh" opened a
   * second real-money session and abandoned the first. Keeping the id is what
   * makes it a refresh.
   */
  async refresh({ userId, sessionId, now = new Date() }) {
    this.#requireProvider();

    const session = await this.#ownedSession({ userId, sessionId });

    const params = this.#compact({
      sportsbook_uuid: session.sportsbook_uuid,
      currency: PROVIDER_CURRENCY[session.currency] ?? session.currency,
      session_id: session.session_id,
      player_id: String(userId),
      language: session.language || undefined,
    });

    const response = await this.#upstream(() => this.provider.post(PATHS.INIT, params));
    if (!response?.url) throw E.UPSTREAM_REJECTED({ sessionId });

    await session.update({
      token: response.token ?? session.token,
      launch_url: response.url,
      updated_at: now,
    });

    return { sessionId: session.session_id, url: response.url, token: response.token ?? session.token };
  }

  /**
   * @legacy POST /sportsbooks/logout
   *
   * The token goes to the provider; the caller never sends one. Legacy took it
   * from the body, which meant anyone holding a token — or guessing one — could
   * end someone else's session mid-bet.
   */
  async logout({ userId, sessionId, now = new Date() }) {
    this.#requireProvider();

    const session = await this.#ownedSession({ userId, sessionId });

    /**
     * Closed locally FIRST, and upstream failure does not reopen it.
     *
     * A player asking to end a session should end it. If the provider call
     * fails, the worst case is a session that lingers on their side and expires
     * on its own — better than telling the player they are logged out while our
     * row says they are still playing.
     */
    await session.update({ status: SESSION_STATUS.CLOSED, closed_at: now, updated_at: now });

    if (session.token) {
      try {
        await this.provider.post(PATHS.LOGOUT, { token: session.token });
      } catch (error) {
        this.logger?.warn(
          { err: error, sessionId, userId: String(userId) },
          'Sportsbook logout: session closed locally, provider did not confirm'
        );
      }
    }

    return { sessionId: session.session_id, status: SESSION_STATUS.CLOSED };
  }

  /**
   * This player's sessions.
   *
   * Not a legacy endpoint — legacy could not have written it, since it stored
   * nothing. It is here because a player needs to find a session they still
   * have open, and support needs to see that a player was sent to a book at
   * all. `token` and `launch_url` are excluded: the URL carries the token on
   * some books, and a token is a bearer credential for the session.
   */
  async sessions({ userId, limit = 20 }) {
    const rows = await this.models.SportsbookSession.findAll({
      where: { user_id: userId },
      attributes: ['session_id', 'sportsbook_uuid', 'currency', 'status', 'created_at', 'closed_at'],
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    });

    return rows;
  }

  // ══════════════════════════════════════════════════════════════════════

  /** A session that exists, is the caller's, and is still open. */
  async #ownedSession({ userId, sessionId }) {
    const session = await this.models.SportsbookSession.findOne({
      where: { session_id: sessionId },
    });

    /**
     * "Not yours" and "does not exist" answer identically.
     *
     * Otherwise the endpoint is an oracle for which session ids are real —
     * and a session id is what legacy's logout accepted as authorisation.
     */
    if (!session || String(session.user_id) !== String(userId)) throw E.SESSION_NOT_FOUND({ sessionId });
    if (session.status !== SESSION_STATUS.OPEN) throw E.SESSION_CLOSED({ sessionId });

    return session;
  }

  /** Close sessions older than the TTL so the open-session index frees up. */
  async #expireStale({ userId, now }) {
    const cutoff = new Date(now.getTime() - SESSION_TTL_MS);

    const [closed] = await this.models.SportsbookSession.update(
      { status: SESSION_STATUS.CLOSED, closed_at: now, updated_at: now },
      { where: { user_id: userId, status: SESSION_STATUS.OPEN, created_at: { [Op.lt]: cutoff } } }
    );

    if (closed) this.logger?.info({ userId: String(userId), closed }, 'Expired stale sportsbook sessions');
    return closed;
  }

  #requireProvider() {
    if (!this.provider?.configured) throw E.NOT_CONFIGURED();
  }

  async #upstream(call) {
    try {
      return await call();
    } catch (error) {
      this.logger?.error({ err: error, status: error?.status }, 'Sportsbook provider call failed');
      if (error?.status >= 400 && error.status < 500) throw E.UPSTREAM_REJECTED({ status: error.status });
      throw E.UPSTREAM_FAILED();
    }
  }

  /** Drop undefined keys — they would be signed as empty strings. */
  #compact(params) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
  }
}

module.exports = { SportsbookService };
