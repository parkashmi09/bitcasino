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

/** casino-service configuration. Validated once at boot; a bad value stops the process here. */
const config = loadEnv(
  {
    ...httpEnvShape,
    ...dbEnvShape,
    ...jwtEnvShape,
    ...adminJwtEnvShape,
    // Identify this service to the others — see `internalAcl.js`.
    ...internalKeysEnvShape,
    ...serviceDiscoveryEnvShape,
    CASINO_SERVICE_PORT: coercers.int(4003),

    // ── Seamless wallet (the casino provider's bet/win callbacks) ─────
    // The key was hard-coded in legacy/index.js:2376 and is in the repository
    // history — rotate it with the provider before this goes live.
    SEAMLESS_SECRET_KEY: coercers.optionalStr(),
    SEAMLESS_OPERATOR_CODE: coercers.optionalStr(),

    /**
     * How stale a `request_time` may be, in seconds.
     *
     * The provider's signature covers only the action name, so a captured one
     * is otherwise valid forever. This is what gives it an expiry. Set to 0 to
     * disable — only if the provider's clocks cannot be trusted at all, and
     * knowing that removes the replay window entirely.
     */
    SEAMLESS_MAX_SKEW_SECONDS: coercers.int(300),

    /**
     * `legacy` speaks the provider's documented scheme. `full` signs the
     * member, transaction ids and amounts too, which removes the replay
     * problem rather than narrowing it — use it if the provider supports it.
     */
    SEAMLESS_SIGN_MODE: coercers.str('legacy'),

    /**
     * The operator API — the outbound half of the same integration.
     *
     * Legacy hard-coded `https://staging.gsimw.com/api/operators`. A STAGING
     * host, in the production source, serving the live game catalogue.
     */
    SEAMLESS_OPERATOR_BASE_URL: coercers.str('https://staging.gsimw.com/api/operators'),
    SEAMLESS_TIMEOUT_MS: coercers.int(15_000),

    /** Currency quoted when opening a session. Legacy hard-coded 'USD'. */
    SEAMLESS_LAUNCH_CURRENCY: coercers.str('USD'),

    /**
     * Where the provider returns a player who closes a game.
     *
     * Legacy sent `http://localhost:3000`, so every player exiting a game was
     * pointed at their own machine.
     */
    SEAMLESS_LOBBY_URL: coercers.optionalStr(),

    // ── Slotegrator / GIS ─────────────────────────────────────────────
    // The merchant id and key were hard-coded at the top of
    // `legacy/gis/controller.js` and are in the repository history. Rotate them
    // with Slotegrator before this goes live.
    GIS_BASE_URL: coercers.str('https://gis.slotegrator.com/api/index.php/v1'),
    GIS_MERCHANT_ID: coercers.optionalStr(),
    GIS_MERCHANT_KEY: coercers.optionalStr(),

    /**
     * How stale an inbound `X-Timestamp` may be, in seconds.
     *
     * The header is inside the signature, so it cannot be edited — but legacy
     * never checked it was RECENT, which left a captured request valid forever.
     * Set to 0 to disable, which removes that expiry entirely.
     */
    GIS_MAX_SKEW_SECONDS: coercers.int(300),

    /**
     * Minimum gap between outbound calls, in milliseconds.
     *
     * Slotegrator's production limit is about one request per second, and a
     * full catalogue sync is hundreds of pages. Legacy slept 1100ms inside eachv
     * sync loop, which held for one loop and not for two at once.
     */
    GIS_RATE_LIMIT_MS: coercers.int(1100),
    GIS_TIMEOUT_MS: coercers.int(15_000),

    /**
     * Where a player lands when they close a game.
     *
     * Legacy hard-coded `https://addaplay.com/game-exit.html` and discarded the
     * caller's `return_url`, so every brand on the platform exited to one
     * brand's page.
     */
    GIS_RETURN_URL: coercers.optionalStr(),

    // ── Slotegrator betting / sportsbook ──────────────────────────────
    /**
     * The same vendor and the same signing scheme as GIS above, on a DIFFERENT
     * merchant account — so it gets its own credentials and its own client.
     *
     * The legacy default was `https://gis-betting-stage.stgr.pw/api/v1`, with
     * its merchant id and key hard-coded. Note the `-stage`: those are the
     * provider's STAGING credentials, consistent with the module never having
     * been mounted. There is no default here — an unconfigured integration
     * refuses rather than signing with a staging key against production.
     */
    SPORTSBOOK_BASE_URL: coercers.optionalStr(),
    SPORTSBOOK_MERCHANT_ID: coercers.optionalStr(),
    SPORTSBOOK_MERCHANT_KEY: coercers.optionalStr(),
    SPORTSBOOK_RATE_LIMIT_MS: coercers.int(1100),
    SPORTSBOOK_TIMEOUT_MS: coercers.int(15_000),
    /** Where a player lands when they close the book. */
    SPORTSBOOK_RETURN_URL: coercers.optionalStr(),

    // ── jsGames v1 (huidu.bet) ────────────────────────────────────────
    // `agency_uid` and `aes_key` were a static class property in
    // `legacy/jsgames/controller.js` and are in the repository history.
    JSGAMES_V1_BASE_URL: coercers.str('https://huidu.bet'),
    JSGAMES_V1_AGENCY_UID: coercers.optionalStr(),
    /** Must be exactly 32 bytes — aes-256. Checked at first use, not at boot. */
    JSGAMES_V1_AES_KEY: coercers.optionalStr(),
    JSGAMES_V1_PLAYER_PREFIX: coercers.str('h24e9e'),

    /** Where the provider sends its bet callbacks. */
    JSGAMES_CALLBACK_URL: coercers.optionalStr(),
    /** Where a player lands when they close a jsGames title. */
    JSGAMES_HOME_URL: coercers.optionalStr(),

    // ── jsGames v2 (games.ibitplay.com) ───────────────────────────────
    // From `legacy/jsgamesv2/config.js`, committed in plain text.
    JSGAMES_V2_BASE_URL: coercers.str('https://games.ibitplay.com/api/game'),
    JSGAMES_V2_API_KEY: coercers.optionalStr(),
    JSGAMES_V2_API_SECRET: coercers.optionalStr(),

    /**
     * How stale a jsGames callback timestamp may be, in seconds.
     *
     * v2's callback was completely unauthenticated, and v1's protection is a
     * shared AES key in ECB mode — which is malleable and has no replay
     * defence of its own. This is what makes a captured message expire.
     */
    JSGAMES_MAX_SKEW_SECONDS: coercers.int(300),
    JSGAMES_TIMEOUT_MS: coercers.int(15_000),

    // ── Aggregator wallet callbacks ───────────────────────────────────
    /**
     * Shared secrets for the three remaining casino callbacks.
     *
     * None of these providers signs its requests, so a shared secret in
     * `x-aggregator-key` is the available control. An aggregator with no secret
     * set REFUSES every callback — legacy's behaviour was to have no check at
     * all, and that is the one outcome worth ruling out explicitly.
     *
     * These need agreeing with each provider before its callbacks will settle.
     */
    AGGREGATOR_ASIA_SECRET: coercers.optionalStr(),
    AGGREGATOR_NEXUS_SECRET: coercers.optionalStr(),
    AGGREGATOR_EVO_SECRET: coercers.optionalStr(),

    /** The platform root operator, who sees every player in the reports. */
    ROOT_STAFF_ID: coercers.int(1),
  },
  { serviceDir: path.resolve(__dirname, '..') }
);

config.SERVICE_NAME = 'casino-service';
config.PORT = config.CASINO_SERVICE_PORT;

module.exports = config;
