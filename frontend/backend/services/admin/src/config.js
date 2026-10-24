'use strict';

const path = require('path');
const {
  loadEnv,
  coercers,
  httpEnvShape,
  dbEnvShape,
  jwtEnvShape,
  adminJwtEnvShape,
  secretEncryptionEnvShape,
  internalKeysEnvShape,
  serviceDiscoveryEnvShape,
} = require('@ibitplay/common');

/** admin-service configuration. Validated once at boot; a bad value stops the process here. */
const config = loadEnv(
  {
    ...httpEnvShape,
    ...dbEnvShape,
    ...jwtEnvShape,
    ...adminJwtEnvShape,
    // TOTP secrets are encrypted at rest — see `secretEncryptionEnvShape`.
    ...secretEncryptionEnvShape,
    // Identify this service to the others — see `internalAcl.js`.
    ...internalKeysEnvShape,
    ...serviceDiscoveryEnvShape,
    ADMIN_SERVICE_PORT: coercers.int(4002),
    // The ceiling on a single direct wallet refill. Legacy had none — one
    // request could credit any amount an operator typed.
    ADMIN_MAX_REFILL: coercers.str('1000000'),

  },
  { serviceDir: path.resolve(__dirname, '..') }
);

config.SERVICE_NAME = 'admin-service';
config.PORT = config.ADMIN_SERVICE_PORT;

module.exports = config;
