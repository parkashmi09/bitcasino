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
 * Validated once at boot. A missing or malformed variable stops the process
 * here with a readable list, rather than throwing on the first request that
 * happens to need it.
 */
const config = loadEnv(
  {
    ...httpEnvShape,
    ...dbEnvShape,
    ...jwtEnvShape,
    ...adminJwtEnvShape,
    // Identify this service to the others — see `internalAcl.js`.
    ...internalKeysEnvShape,
    ...serviceDiscoveryEnvShape,

    SPORTS_SERVICE_PORT: coercers.int(4004),
    // The background worker is a separate process and serves only /health.
    SPORTS_WORKER_PORT: coercers.int(4104),

    // Settlement guardrails. A market that would pay out more than this is
    // refused rather than quietly draining the house account — the legacy code
    // has no such ceiling.
    SPORTS_MAX_PAYOUT: coercers.num(100_000),

    // How far back a settled market stays voidable. The legacy queries hardcode
    // `INTERVAL '30 hours'` in four places; here it is one number.
    SPORTS_VOID_WINDOW_HOURS: coercers.int(30),

    // ── The odds feed ──────────────────────────────────────────────────
    //
    // Nine legacy controllers each hardcoded `http://46.202.164.63:6565/api`
    // and `process.env.SCORESWIFT_KEY || 'bit_wyusjkwiyu'`. Cleartext to a bare
    // IP, with a committed fallback key that made a deployment which forgot the
    // variable work anyway — using the key that is in this repository.
    //
    // Required, with no default on either. A sports service that cannot reach
    // its feed should refuse to start, not start and serve an empty board.
    SPORTS_FEED_URL: coercers.str(),
    SPORTS_FEED_KEY: coercers.str(),
    /**
     * Which dialect the provider behind each URL speaks — see
     * `modules/feed/dialects.js`. Defaults to `diamond`, which is the feed this
     * platform actually runs on; `scoreswift` is the 1:1 passthrough the port
     * was first written against.
     */
    /**
     * Which sports to fetch from the provider, as its own `etid`.
     *
     * A COST control, not a visibility one — `sports_config.enabled` decides
     * what players see. See `modules/feed/dialects.js`.
     */
    SPORTS_ACTIVE_EIDS: coercers.list([]),
    /**
     * Results live on their OWN host — `RESULTS_API_BASE` in the legacy
     * settlement cron. Separate from the odds feed, so separate config.
     */
    SPORTS_RESULTS_URL: coercers.str('https://diamond-result-v2.avrkhub.in'),
    SPORTS_RESULTS_KEY: coercers.str('none'),
    SPORTS_RESULTS_DIALECT: coercers.str('diamond'),

    // ── The two settlement jobs ────────────────────────────────────────
    //
    // Ported from `legacy/sportsmain/cron/job.js` (the result scanner) and
    // `legacy/sportsmain/cron/settlement.js` (the payout worker), which were
    // two standalone processes reading their own `process.env` directly.
    // Every value below is that file's default, named for the job it belongs
    // to instead of the generic `RESULTS_*` / `SETTLE_*` the crons used.

    /** `CRON_INTERVAL_MS` — how often the scanner re-checks open bets. */
    SPORTS_RESULT_POLL_MS: coercers.int(60_000),
    /** `RESULTS_RATE_LIMIT_MS` — minimum gap between provider calls. */
    SPORTS_RESULT_RATE_LIMIT_MS: coercers.int(250),
    /** `RESULTS_MAX_FETCH_RETRIES` / `RESULTS_RETRY_BASE_MS`. */
    SPORTS_RESULT_MAX_RETRIES: coercers.int(6),
    SPORTS_RESULT_RETRY_BASE_MS: coercers.int(500),
    /** `API_TIMEOUT_MS`. The scanner used 60s, the payout worker 30s. */
    SPORTS_RESULT_TIMEOUT_MS: coercers.int(60_000),
    /** `MAX_CONCURRENT_API` — the payout worker's in-flight cap. */
    SPORTS_RESULT_MAX_CONCURRENT: coercers.int(3),
    /** `SUMMARY_RETENTION_DAYS` / `BET_CACHE_TTL_DAYS` — the scanner's pruning. */
    SPORTS_SUMMARY_RETENTION_DAYS: coercers.int(7),
    SPORTS_BET_CACHE_TTL_DAYS: coercers.int(14),

    /** `CRON_SCHEDULE` — the payout worker ran once a minute. */
    SPORTS_SETTLEMENT_INTERVAL_MS: coercers.int(60_000),
    /** `SETTLE_BATCH_LIMIT` — jobs claimed per poll. */
    SPORTS_SETTLEMENT_BATCH: coercers.int(10),
    /** `SETTLE_STALE_PROCESSING_MIN` — reclaim jobs a crashed run left claimed. */
    SPORTS_SETTLEMENT_STALE_MIN: coercers.int(5),
    /** `LEDGER_ZERO_ROWS` — write a wallet/ledger row even when the credit is 0. */
    SPORTS_SETTLEMENT_LEDGER_ZERO_ROWS: coercers.bool(false),
    SPORTS_FEED_DIALECT: coercers.str('diamond'),
    SPORTS_LIVE_DIALECT: coercers.str('diamond'),
    SPORTS_MEDIA_DIALECT: coercers.str('diamond'),
    SPORTS_FEED_TIMEOUT_MS: coercers.int(8_000),
    // Match results arrive over this connection. Accepting plain http means
    // accepting that anyone on the network path can decide who won, so it has
    // to be switched on deliberately rather than inherited from a literal.
    SPORTS_FEED_ALLOW_INSECURE: coercers.bool(false),
    SPORTS_FEED_TIMEZONE: coercers.str('Asia/Kolkata'),
    // How long the global sports on/off flag is reused before asking
    // admin-service again. Legacy queried it once per request.
    SPORTS_ENABLED_TTL_MS: coercers.int(5_000),

    // ── The second and third providers ────────────────────────────────
    //
    // `sportsmain/API/controller.js` reads from two more upstreams, both
    // hardcoded: `http://159.198.77.241:8100` (another bare IP over cleartext)
    // for fixtures and results, and
    // `https://diamond-sports-api-demo-s2.avrkhub.in` — a host with `-demo-`
    // in its name — for the live video stream and the scorecard, with the key
    // in the QUERY STRING.
    //
    // Optional: a deployment that has not wired them gets a clear 501 from the
    // three endpoints that need them rather than a failure at boot.
    SPORTS_LIVE_URL: coercers.str(''),
    SPORTS_LIVE_KEY: coercers.str(''),
    SPORTS_MEDIA_URL: coercers.str(''),
    SPORTS_MEDIA_KEY: coercers.str(''),

    // The price a bet may differ from the board by before it is refused. The
    // legacy bet path compared the submitted odds to nothing at all.
    SPORTS_ODDS_TOLERANCE: coercers.str('0.01'),
    SPORTS_MIN_STAKE: coercers.str('1'),
    SPORTS_MAX_STAKE: coercers.str('50000'),
  },
  { serviceDir: path.resolve(__dirname, '..') }
);

config.SERVICE_NAME = 'sports-service';
config.PORT = config.SPORTS_SERVICE_PORT;

module.exports = config;
