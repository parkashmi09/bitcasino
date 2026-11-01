'use strict';

const { callParent } = require('./hubCredentials');

/**
 * Copy side: the original-games client on a whitelabel copy. Its calls run on the PARENT's
 * account (`POST /og/provider`): opening a session and the game list only. Errors keep the
 * client's shape (`status`, `code`) that OriginalGamesService reads.
 */
class OgHubProvider {
  constructor(deps) {
    this.deps = deps;
  }

  get configured() {
    return true;
  }

  async request(method, path, { body } = {}) {
    try {
      return await callParent(this.deps, 'POST', '/og/provider', { method, path, body });
    } catch (error) {
      const wrapped = new Error(error.message);
      wrapped.status = error.refused ? error.status ?? 422 : null;
      wrapped.code = error.code ?? null;
      throw wrapped;
    }
  }
}

module.exports = { OgHubProvider };
