'use strict';

const password = require('./password');
const totp = require('./totp');
const permissions = require('./permissions');
const { TokenService, TOKEN_TYPES } = require('./tokens');
const {
  createAuthMiddleware,
  markAuthorization,
  isAuthorizationMiddleware,
} = require('./middleware');
const { SecretBox, createSecretBox } = require('./secretBox');

/** @ibitplay/auth — tokens, hashing, 2FA and the route-protection middleware. */
module.exports = {
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
  SecretBox,
  createSecretBox,
};
