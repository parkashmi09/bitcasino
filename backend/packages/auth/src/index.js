'use strict';

const password = require('./password');
const totp = require('./totp');
const permissions = require('./permissions');
const { TokenService, TOKEN_TYPES } = require('./tokens');
const {
  createAuthMiddleware,
  markAuthorization,
  isAuthorizationMiddleware,
  denyAgentTree,
  PROMOTIONS_NOT_FOR_AGENTS,
  VAULT_NOT_FOR_AGENTS,
  SWAP_NOT_FOR_AGENTS,
  PASSWORD_CHANGE_REQUIRED,
  ACCOUNT_LOCKED,
  passwordChangeAllows,
} = require('./middleware');
const { SecretBox, createSecretBox } = require('./secretBox');
const agentPlayers = require('./agentPlayers');
const txnPasswordMode = require('./transactionPasswordMode');

/** @ibitplay/auth — tokens, hashing, 2FA and the route-protection middleware. */
module.exports = {
  ...txnPasswordMode,
  ...password,
  totp,
  ...permissions,
  TokenService,
  TOKEN_TYPES,
  createAuthMiddleware,
  // Exported so tools and test stubs can mark a stand-in guard the same way
  // the real middleware does — see `moduleLoader`'s admin-write check.
  markAuthorization,
  isAuthorizationMiddleware,
  denyAgentTree,
  PROMOTIONS_NOT_FOR_AGENTS,
  VAULT_NOT_FOR_AGENTS,
  SWAP_NOT_FOR_AGENTS,
  PASSWORD_CHANGE_REQUIRED,
  ACCOUNT_LOCKED,
  passwordChangeAllows,
  // Players owned by the agent tree: no promotions, vault, deposits, swap or withdrawals.
  ...agentPlayers,
  SecretBox,
  createSecretBox,
};
