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
  geoEnvShape,
} = require('@ibitplay/common');

/** user-service configuration. Validated once at boot; a bad value stops the process here. */
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
    // IP → location for the login history — see `geoEnvShape`.
    ...geoEnvShape,
    USER_SERVICE_PORT: coercers.int(4001),
    USER_WORKER_PORT: coercers.int(4101),

    /**
     * Whose day a race runs on.
     *
     * The implementation this was ported from hardcoded `Asia/Kolkata` in five
     * places — an offset constant, three cron schedules and a front-end helper —
     * with nothing tying them together, so changing the operator's day meant
     * finding all five and missing one meant a window and its settlement running
     * on different days. One value, read once, passed down.
     */
    RACE_TIMEZONE: coercers.str('Asia/Kolkata'),

    // Where identity documents are written. Outside the repo and outside any
    // directory a web server serves — the only way to read one is through the
    // authorised endpoint, which checks ownership first.
    KYC_STORAGE_DIR: coercers.str(path.resolve(__dirname, '../../../storage/kyc')),

    // Proof-of-payment uploads. Same rule as KYC: outside any served directory,
    // reachable only through the endpoint that checks ownership first.
    DEPOSIT_STORAGE_DIR: coercers.str(path.resolve(__dirname, '../../../storage/deposits')),

    // Withdrawal policy.
    WITHDRAW_MINIMUM: coercers.str('1'),
    // A payout to an unverified identity is what AML rules exist to prevent.
    // Configurable, but defaults to ON — legacy performed no check at all.
    WITHDRAW_REQUIRE_KYC: coercers.bool(true),

    // Smallest amount that may be locked into a vault deposit.
    VAULT_MINIMUM: coercers.str('1'),

    // ── Payment-provider secrets ──────────────────────────────────────
    // Optional at boot so a deployment can run without every integration
    // configured. A provider with a blank secret refuses its callbacks —
    // see modules/psp/psp.service.js #assertConfigured.
    WAYPAY_MERCHANT_KEY: coercers.optionalStr(),
    APAY_WEBHOOK_ACCESS_KEY: coercers.optionalStr(),
    APAY_WEBHOOK_PRIVATE_KEY: coercers.optionalStr(),
    CRICPAY_SECRET_KEY: coercers.optionalStr(),
    CRICPAY_SECRET_IV: coercers.optionalStr(),
    // CricPay's callback does not name the transaction it refers to, so the
    // outcome is confirmed with CricPay over a merchant-authenticated call
    // before anything is credited. That needs the merchant code and host, which
    // makes them settlement dependencies, not just API-call convenience.
    CRICPAY_MERCHANT_CODE: coercers.optionalStr(),
    CRICPAY_BASE_URL: coercers.optionalStr(),
    UPI_WEBHOOK_SECRET: coercers.optionalStr(),

    // How long to wait on a provider before treating it as unreachable. Short:
    // a callback handler holding a connection open for a minute is how a
    // provider outage becomes our outage.
    PSP_TIMEOUT_MS: coercers.int(10_000),

    // ── Outbound provider credentials (starting a payment) ────────────
    // Separate from the callback secrets above: these authenticate US to the
    // provider, those authenticate the provider to us. Every one of them was
    // a literal in the legacy source and must be treated as compromised.
    WAYPAY_BASE_URL: coercers.optionalStr(),
    APAY_API_KEY: coercers.optionalStr(),
    APAY_PROJECT_ID: coercers.optionalStr(),
    APAY_BASE_URL: coercers.optionalStr(),
    APAY_RETURN_URL: coercers.optionalStr(),
    APAY_DEPOSIT_WEBHOOK_ID: coercers.optionalStr(),
    APAY_WITHDRAWAL_WEBHOOK_ID: coercers.optionalStr(),
    UPI_API_KEY: coercers.optionalStr(),
    UPI_BASE_URL: coercers.optionalStr(),
    UPI_REDIRECT_URL: coercers.optionalStr(),
    UPI_CUSTOMER_EMAIL: coercers.optionalStr(),

    /**
     * CCPayment — the crypto deposit provider.
     *
     * ═══════════════════════════════════════════════════════════════════
     * THESE WERE READ BUT NEVER DECLARED, SO THEY COULD NOT BE SET
     *
     * `crypto.service.js` and `payment-orders/gateways/index.js` both read
     * `config.CCPAYMENT_*`, and `loadEnv` returns ONLY what a shape declares —
     * an undeclared variable is absent from `config` however the `.env` reads.
     * So every CCPayment call saw `undefined` and answered NOT_CONFIGURED, and
     * every webhook was refused, no matter what the operator put in the file.
     * There was nothing to put in the file either: none of the three appear in
     * `.env.example`.
     *
     * Exactly the failure `cacheEnvShape` in packages/common/src/env.js
     * describes for `REDIS_URL`.
     *
     * Optional, like every other provider here — a blank secret refuses
     * callbacks rather than accepting unverified ones, which is the behaviour
     * this deployment already has and should keep until real credentials land.
     * ═══════════════════════════════════════════════════════════════════
     */
    CCPAYMENT_APP_ID: coercers.optionalStr(),
    CCPAYMENT_APP_SECRET: coercers.optionalStr(),
    CCPAYMENT_BASE_URL: coercers.optionalStr(),
    // Optional override of CCPayment's live coin list, as JSON: {"USDT":1280,"BTC":1155}. Unset = live list.
    CCPAYMENT_COIN_IDS: coercers.optionalStr(),
    CCPAYMENT_RETURN_URL: coercers.optionalStr(),

    // F2Pay — deposits (cashier page). Only its keys live here; its methods are the
    // `payment_methods` table (owner panel + Super Admin). Every request is RSA-SHA256 signed with our
    // private key; every answer and callback is verified with F2PAY_PUBLIC_KEY (the key F2Pay
    // gave for checking its signatures). Keys: PEM, or the bare base64 body on one line.
    F2PAY_MERCHANT_ID: coercers.optionalStr(),
    F2PAY_BASE_URL: coercers.optionalStr(),
    F2PAY_PRIVATE_KEY: coercers.optionalStr(),
    F2PAY_PUBLIC_KEY: coercers.optionalStr(),
    // Where the cashier page sends the player back after paying.
    F2PAY_RETURN_URL: coercers.optionalStr(),

    // Where providers should send their callbacks. Ours, always — legacy read
    // this from the request body, which let the caller redirect the result of
    // their own payment somewhere we would never see.
    PUBLIC_BASE_URL: coercers.str('http://localhost:8080'),

    // The player-facing SITE, as distinct from the API origin above. Referral
    // links point here. Legacy hard-coded `https://addaplay.com` into the
    // affiliate controller, so every non-production environment handed players
    // a link to production.
    PUBLIC_SITE_URL: coercers.str('http://localhost:3000'),

    // Google sign-in (modules/auth/google.js). All three set = the button shows; any missing =
    // sign-in with Google is off and its routes answer 503. The redirect URI is registered in the
    // Google Cloud console: <API origin>/api/v1/user/auth/google/callback.
    GOOGLE_CLIENT_ID: coercers.optionalStr(),
    GOOGLE_CLIENT_SECRET: coercers.optionalStr(),
    GOOGLE_REDIRECT_URI: coercers.optionalStr(),

    // ── Payment limits ────────────────────────────────────────────────
    // Legacy had none, in either direction. A missing upper bound on a payout
    // is what turns a compromised account into an unbounded loss.
    DEPOSIT_MINIMUM: coercers.str('1'),
    DEPOSIT_MAXIMUM: coercers.str('1000000'),
    WITHDRAW_MAXIMUM: coercers.str('500000'),

    /**
     * Master switch for provider-initiated payouts.
     *
     * Defaults OFF. Automatic withdrawal is the most damaging thing on the
     * platform to leave running unattended, and turning it on should be a
     * deliberate act by someone who has checked the credentials and limits —
     * not something that happens because a service started.
     */
    AUTO_WITHDRAWALS_ENABLED: coercers.bool(false),

    // ── Outbound email ────────────────────────────────────────────────
    /**
     * SMTP.
     *
     * Legacy built a transport per request with
     * `<redacted, see backend/docs/ROTATION.md>` / `<redacted, see backend/docs/ROTATION.md>` written into
     * `legacy/index.js:3996`. That password is in the repository history and
     * must be rotated.
     *
     * An unconfigured mailer does not send and does not pretend to — a code
     * that could not be delivered is reported as a failure, because "we sent
     * it" is what the player is told.
     */
    SMTP_HOST: coercers.optionalStr(),
    SMTP_PORT: coercers.int(465),
    SMTP_USER: coercers.optionalStr(),
    SMTP_PASSWORD: coercers.optionalStr(),
    SMTP_MAX_CONNECTIONS: coercers.int(5),
    MAIL_FROM: coercers.optionalStr(),
    /**
     * rainbet: with no SMTP, log what WOULD have been sent (subject, text, links) so a developer
     * can follow reset links and codes locally. Ignored in production.
     */
    MAIL_DRY_RUN: coercers.bool(false),

    /**
     * Where club banner images are written.
     *
     * Outside the repository and outside any directory a web server serves —
     * the only way to read one is through the endpoint that checks club
     * membership first. Legacy hard-coded
     * `/var/www/html/hellogames/ibitplay/backend/clubmembership/clubbanners/images`
     * and served any path joined onto it, unauthenticated.
     */
    CLUB_BANNER_STORAGE_DIR: coercers.str(path.resolve(__dirname, '../../../storage/club-banners')),

    /** The platform root operator, who sees every player in the reports. */
    ROOT_STAFF_ID: coercers.int(1),

    /** Recipients one operator broadcast may reach. */
    EMAIL_BULK_MAX_RECIPIENTS: coercers.int(500),

    /**
     * Where a chat avatar is served from.
     *
     * Legacy read `config.avatarUrl` into a module constant and did
     * `UPLOAD_URL + avatar` with the filename straight from a socket message —
     * so `../` segments and a whole different origin both survived the
     * concatenation, onto a value rendered on every message that player sends.
     * The filename is bounded now; this is the prefix.
     */
    AVATAR_BASE_URL: coercers.optionalStr(),
  },
  { serviceDir: path.resolve(__dirname, '..') }
);

config.SERVICE_NAME = 'user-service';
config.PORT = config.USER_SERVICE_PORT;

module.exports = config;
