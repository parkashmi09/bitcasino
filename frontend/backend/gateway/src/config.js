'use strict';

const path = require('path');
const {
  loadEnv,
  coercers,
  httpEnvShape,
  jwtEnvShape,
  adminJwtEnvShape,
  serviceDiscoveryEnvShape,
} = require('@ibitplay/common');

/**
 * Gateway configuration.
 *
 * Deliberately NO database variables. The gateway must not be able to reach the
 * database — routing and edge auth are all it does, and a component with no
 * credentials cannot leak them.
 */
const config = loadEnv(
  {
    ...httpEnvShape,
    ...jwtEnvShape,
    ...adminJwtEnvShape,
    ...serviceDiscoveryEnvShape,
    GATEWAY_PORT: coercers.int(4000),
    /**
     * The one process on the platform meant to take outside traffic — so it is
     * also the one whose bind address is worth stating separately.
     *
     * Loopback by default, because the usual arrangement is nginx or a load
     * balancer terminating TLS on the same host and proxying inward. Set it to
     * `0.0.0.0` when the gateway runs in its own container, where the network
     * namespace, not the bind address, is what limits reach.
     *
     * The SERVICES have no equivalent knob pointed anywhere but loopback by
     * default (see `startServer`), and they should stay that way: a request
     * that skips the gateway skips header stripping, the `/internal/*` refusal
     * and edge rate limiting.
     */
    GATEWAY_BIND_HOST: coercers.str('127.0.0.1'),
    // Proxy deadline. Longer than a service's own REQUEST_TIMEOUT_MS so the
    // upstream's error surfaces instead of the gateway timing out first and
    // hiding it.
    GATEWAY_PROXY_TIMEOUT_MS: coercers.int(35_000),
    GATEWAY_BODY_LIMIT: coercers.str('10mb'),
  },
  { serviceDir: path.resolve(__dirname, '..') }
);

config.SERVICE_NAME = 'gateway';
config.PORT = config.GATEWAY_PORT;

module.exports = config;
