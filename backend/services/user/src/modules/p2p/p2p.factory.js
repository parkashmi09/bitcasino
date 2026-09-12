'use strict';

const { P2pService } = require('./p2p.service');
const { P2pAdminService } = require('./p2pAdmin.service');

/**
 * Two services, one module.
 *
 * The split is by AUDIENCE, not by table: the player's side opens orders and
 * uploads proofs against its own account, and the operator's side settles them.
 * They share the same rows and the same wallet, and keeping them apart is what
 * makes "does this method take a `userId` from a token or a `staff` from a
 * permission" a property of the file rather than of the call site.
 *
 * `legacy/peerTrade/controler.js` had all 21 handlers in one object with no
 * distinction between them — which is part of how thirteen admin routes ended
 * up with no guard.
 */
function buildP2pService(deps) {
  return new P2pService(deps);
}

function buildP2pAdminService(deps) {
  return new P2pAdminService(deps);
}

module.exports = { buildP2pService, buildP2pAdminService };
