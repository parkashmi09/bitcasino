'use strict';

const { defineErrors } = require('@ibitplay/common');

const { SeamlessOperatorClient } = require('./provider/operatorClient');

const E = defineErrors('SEAMLESSOP', {
  NOT_CONFIGURED: { status: 503, message: 'The seamless operator API is not configured' },
  UPSTREAM_FAILED: { status: 502, message: 'The game provider could not be reached' },
  UPSTREAM_REJECTED: { status: 502, message: 'The game provider rejected the request' },
  PROVIDER_NOT_FOUND: { status: 404, message: 'No products found for that provider' },
  USER_NOT_FOUND: { status: 404, message: 'Player not found' },
  CASINO_LOCKED: { status: 403, message: 'Casino play is locked on this account' },
});

/**
 * The operator side of the seamless integration: products, games, launch.
 *
 * Kept beside the wallet callbacks because it is the same provider, the same
 * operator code and the same secret — but in its own service, because none of
 * it touches a balance and mixing "list the games" into the file that settles
 * bets makes both harder to read.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `POST /launch-game` SENT THE PLAYER'S PASSWORD HASH TO THE PROVIDER
 *
 * The single worst line in the casino surface:
 *
 *     const userQuery = 'SELECT password, name FROM users WHERE id = $1';
 *     ...
 *     password: password,      // users.password — the bcrypt login credential
 *
 * transmitted in a JSON body to `staging.gsimw.com`, on a route with no
 * authentication where `memberAccount` came from the request body. Anyone could
 * make us send any player's credential hash to a third party.
 *
 * The provider needs a stable per-member secret, not ours. See
 * `operatorClient.memberSecret()`.
 *
 * ── TWO MORE ─────────────────────────────────────────────────────────────
 *
 * `GET /fetch-games` REFERENCED AN UNDEFINED VARIABLE. `console.log(sign)` — no
 * `sign` is in scope anywhere in that handler. A ReferenceError inside the
 * `Promise.all`, so the endpoint returned 500 on every call it ever received.
 *
 * IT ALSO FANNED OUT ONE REQUEST PER PRODUCT with no bound. A provider with
 * forty products meant forty simultaneous upstream calls from a single
 * unauthenticated GET.
 *
 * The base URL was `https://staging.gsimw.com` — a staging host, hard-coded,
 * in the production source. It is configuration now, and the credentials that
 * went with it are in the repository history.
 */
class SeamlessCatalogueService {
  constructor({ models, config, logger, operator }) {
    this.models = models;
    this.config = config;
    this.logger = logger;
    this.operator =
      operator ??
      new SeamlessOperatorClient({
        baseUrl: config.SEAMLESS_OPERATOR_BASE_URL,
        operatorCode: config.SEAMLESS_OPERATOR_CODE,
        secretKey: config.SEAMLESS_SECRET_KEY,
        timeoutMs: config.SEAMLESS_TIMEOUT_MS,
        logger,
      });
  }

  /** @legacy GET /fetch-products */
  async products() {
    this.#require();
    return this.#upstream(() => this.operator.get('/available-products', 'productlist'));
  }

  /**
   * @legacy GET /fetch-games
   *
   * Every game a named provider offers, of a given type.
   */
  async games({ providerName, gameType }) {
    this.#require();

    const products = await this.products();
    const matching = (Array.isArray(products) ? products : products?.data ?? []).filter(
      (p) => String(p?.provider ?? '').toLowerCase() === String(providerName).toLowerCase()
    );

    if (!matching.length) throw E.PROVIDER_NOT_FOUND({ providerName });

    /**
     * Fanned out in bounded batches rather than all at once.
     *
     * Legacy did `Promise.all(filteredProducts.map(...))` with no limit, so one
     * unauthenticated GET could open forty simultaneous upstream connections.
     */
    const results = [];
    const BATCH = 5;

    for (let i = 0; i < matching.length; i += BATCH) {
      const batch = matching.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map((product) =>
          this.operator.get('/provider-games', 'gamelist', {
            product_code: product.product_code,
            game_type: gameType,
          })
        )
      );

      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === 'fulfilled') {
          results.push({ product_code: batch[index].product_code, games: outcome.value });
        } else {
          // One product failing must not lose the other thirty-nine. Legacy's
          // `Promise.all` rejected the whole call on the first failure.
          this.logger?.warn(
            { err: outcome.reason, productCode: batch[index].product_code },
            'Seamless game list failed for one product'
          );
          results.push({ product_code: batch[index].product_code, games: null, failed: true });
        }
      }
    }

    return results;
  }

  /**
   * @legacy POST /launch-game
   *
   * The player comes from the token. Legacy took `memberAccount` from the body
   * on an unauthenticated route — so anyone could open a session on any
   * account, AND make us transmit that account's password hash.
   */
  async launch({ userId, gameType, productCode, gameCode, ip }) {
    this.#require();

    const user = await this.models.Users.findByPk(userId, {
      // NOTE the absence of `password`. That is the point of this method.
      attributes: ['id', 'name', 'casino_locked', 'system_locked'],
      raw: true,
    });

    if (!user) throw E.USER_NOT_FOUND({ userId });
    if (user.casino_locked || user.system_locked) throw E.CASINO_LOCKED({ userId });

    const memberAccount = String(userId);

    const response = await this.#upstream(() =>
      this.operator.post('/launch-game', 'launchgame', {
        member_account: memberAccount,
        // Derived from our key, not from the player's credential.
        password: this.operator.memberSecret(memberAccount),
        currency: this.config.SEAMLESS_LAUNCH_CURRENCY || 'USD',
        game_code: gameCode,
        product_code: productCode,
        game_type: gameType,
        language_code: 0,
        ip: ip || '127.0.0.1',
        platform: 'web',
        nickname: user.name,
        // Legacy hard-coded `http://localhost:3000` here, which is where the
        // provider sent every player who closed a game.
        operator_lobby_url: this.config.SEAMLESS_LOBBY_URL || undefined,
      })
    );

    return response;
  }

  #require() {
    if (!this.operator?.configured) throw E.NOT_CONFIGURED();
  }

  async #upstream(call) {
    try {
      return await call();
    } catch (error) {
      this.logger?.error({ err: error, status: error?.status }, 'Seamless operator call failed');
      if (error?.status >= 400 && error.status < 500) throw E.UPSTREAM_REJECTED({ status: error.status });
      throw E.UPSTREAM_FAILED();
    }
  }
}

module.exports = { SeamlessCatalogueService, E };
