'use strict';

const path = require('path');
const {
  loadEnv,
  coercers,
  httpEnvShape,
  dbEnvShape,
  jwtEnvShape,
  adminJwtEnvShape,
  internalKeysEnvShape,
  serviceDiscoveryEnvShape,
} = require('@ibitplay/common');

/**
 * sports-service configuration.
 *
 * The sportsbook is the mssports code exported from TENEXCH (`lib/`, `models/`, the modules'
 * `controllers/` … `workers/`), moved here unchanged. That code reads `process.env` itself, at the
 * moment each file needs a value, exactly as it did in TENEXCH — `loadEnv` has already put
 * `backend/.env` into `process.env` by then, and the four worker processes inherit it.
 *
 * So the shape below does two jobs: it validates the platform keys this service uses itself
 * (HTTP, JWT secrets for the token bridge, internal keys, the DB the `bet-admin` / `wager-report`
 * modules read), and it names the mssports keys that matter, with TENEXCH's own defaults, so a
 * malformed one stops the process here instead of on the first bet. Every other mssports knob
 * (buffers, poll intervals, retries — listed in `backend/.env.example`) is read by the code with
 * its own default.
 */
const config = loadEnv(
  {
    ...httpEnvShape,
    ...dbEnvShape,
    ...jwtEnvShape,
    ...adminJwtEnvShape,
    ...internalKeysEnvShape,
    ...serviceDiscoveryEnvShape,

    SPORTS_SERVICE_PORT: coercers.int(4004),
    // The worker supervisor (src/worker.js) serves /health here; the four mssports workers it
    // runs are child processes.
    SPORTS_WORKER_PORT: coercers.int(4104),
    // How long the site's sports on/off flag is reused before asking admin-service again.
    SPORTS_ENABLED_TTL_MS: coercers.int(5_000),

    // ── mssports ───────────────────────────────────────────────────────
    // The Postgres schema its tables live in (migration 094-mssports-schema).
    MSSPORTS_DB_SCHEMA: coercers.str('mssports'),

    // Odds + events: AVRKHUB, called directly (`SPORTS_API_VERSION=v2`, the live path).
    // Without them the board is empty and every bet is refused FEED_UNAVAILABLE (fail-closed).
    SPORTS_API_VERSION: coercers.str('v2'),
    AVRKHUB_SPORTS_BASE_URL: coercers.optionalStr(),
    AVRKHUB_SPORTS_KEY: coercers.optionalStr(),
    // The results API the results worker polls.
    AVRKHUB_BASE_URL: coercers.str('https://diamond-result-v2.avrkhub.in'),

    // Redis: the events cache, betting config cache, the settlement wake channel and the
    // worker → socket balance relay.
    REDIS_HOST: coercers.str('127.0.0.1'),
    REDIS_PORT: coercers.int(6379),
    REDIS_DB: coercers.int(1),

    // Where the results and settlement workers write their own log files (default below).
    MSSPORTS_LOG_DIR: coercers.optionalStr(),
  },
  { serviceDir: path.resolve(__dirname, '..') }
);

config.MSSPORTS_LOG_DIR ||= path.resolve(__dirname, '../../../../logs/mssports');
config.SERVICE_NAME = 'sports-service';
config.PORT = config.SPORTS_SERVICE_PORT;

module.exports = config;
