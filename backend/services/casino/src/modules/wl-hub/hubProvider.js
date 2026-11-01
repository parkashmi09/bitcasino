'use strict';

const { SlotegratorClient } = require('../gis/provider/slotegrator');
const { callParent } = require('./hubCredentials');

/**
 * Copy side: the Slotegrator client on a whitelabel copy. The copy has no Slotegrator keys and its
 * IP is not on Slotegrator's list, so every call goes to the PARENT (`POST /gis/provider`), which
 * makes it on its own merchant account. The parent allows only what a copy needs: opening a game
 * (real and demo), the lobby, and the catalogue reads; freespins and vouchers stay off.
 *
 * Errors keep the shape `GisService.#upstream` reads: `status` 4xx = refused, else failed.
 */
class HubProvider {
  constructor(deps) {
    this.deps = deps;
    this.logger = deps.logger;
  }

  get configured() {
    return true;
  }

  get(path, params = {}) {
    return this.#call('GET', path, params);
  }

  post(path, params = {}) {
    return this.#call('POST', path, params);
  }

  /** The copy never checks a Slotegrator signature: the parent did, and signs what it passes on. */
  sign() {
    throw new Error('A whitelabel copy does not verify Slotegrator signatures');
  }

  async #call(method, path, params) {
    try {
      return await callParent(this.deps, 'POST', '/gis/provider', { method, path, params });
    } catch (error) {
      const wrapped = new Error(error.message);
      wrapped.status = error.refused ? error.status ?? 422 : 502;
      throw wrapped;
    }
  }
}

// Paging is the real client's, over this `get`.
HubProvider.prototype.getAllPages = SlotegratorClient.prototype.getAllPages;

module.exports = { HubProvider };
