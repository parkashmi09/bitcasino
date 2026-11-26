'use strict';

const { callParent } = require('./hubCredentials');

/**
 * Copy side: the JSGames V2 client on a whitelabel copy. JSGames knows ONE account — the parent's
 * key, the parent's server IP and the parent's callback URL — so a copy never calls it: opening a
 * game goes to the PARENT (`POST /js/provider`), which launches on its own account under a numeric
 * alias it issues for the player (forward `jsAlias`). The bet callbacks for that id reach the parent, which verifies
 * JSGames' signature and passes them on (`POST /in/js`, wl-hub/forward `forwardJs`).
 *
 * Only the launch is offered to a copy. Errors keep the shape `JsGamesService.#upstream` reads:
 * `status` 4xx = refused, anything else = the provider (or the parent) could not be reached.
 */
class JsHubProvider {
  constructor(deps, call = callParent) {
    this.deps = deps;
    this.call = call;
  }

  get configured() {
    return true;
  }

  /**
   * A copy holds no JSGames secret to check a signature with, and JSGames never calls a copy: a
   * callback arriving here directly is refused. The parent's pass-on is `trusted` and skips this.
   */
  verify() {
    return 'a whitelabel copy takes JSGames callbacks from its parent only';
  }

  async request(path, { method = 'GET', body } = {}) {
    try {
      return await this.call(this.deps, 'POST', '/js/provider', { method, path, body: body ?? {} });
    } catch (error) {
      const wrapped = new Error(error.message);
      wrapped.status = error.refused ? error.status ?? 422 : 502;
      wrapped.code = error.code ?? null;
      throw wrapped;
    }
  }

  /** Bet history lives on the parent's account and is not split per copy: not offered. */
  async requestUser() {
    const error = new Error('Not available to a whitelabel');
    error.status = 403;
    throw error;
  }
}

module.exports = { JsHubProvider };
