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
    /**
     * The template a FRESH database starts on — a key from featureCatalogue.js
     * (`carbon_gold`, `violet_night`, `emerald_dark`, `neon_navy`; the old
     * clone names still resolve, see LEGACY_TEMPLATES). Applied once, to a
     * database that has never had a template; with it comes the VIP ladder.
     * After that the template is the owner's (the entitlement document's
     * `template`, docs/OWNER-PANEL.md §2) and this is ignored.
     */
    SITE_TEMPLATE: coercers.optionalStr(),
    // The ceiling on a single direct wallet refill. Legacy had none — one
    // request could credit any amount an operator typed.
    ADMIN_MAX_REFILL: coercers.str('1000000'),

    /**
     * The owner panel — what this site is entitled to. See docs/OWNER-PANEL.md.
     * It sends each signed version to `/api/v1/admin/owner` with
     * `x-owner-key: OWNER_SHARED_SECRET`; unset, that API is closed and the
     * site is not owner-managed. The document lives in `owner_entitlements`,
     * re-read every `OWNER_POLL_SECONDS` (another process may have saved).
     */
    OWNER_SHARED_SECRET: coercers.optionalStr(),
    OWNER_POLL_SECONDS: coercers.int(15),
    // Hardening — see `modules/entitlements/entitlements.store.js`. The verify
    // key is the owner panel's Ed25519 PUBLIC key; it cannot sign anything.
    OWNER_VERIFY_KEY: coercers.optionalStr(),
    OWNER_SITE_KEY: coercers.optionalStr(),
    OWNER_MAX_AGE_SECONDS: coercers.int(300),

    /**
     * Push images and click URLs (modules/push). OneSignal's servers fetch
     * notification images, so they must be served from a PUBLIC https origin —
     * normally the player site itself, whose /api/* rewrite reaches the
     * gateway. PUBLIC_ASSET_ORIGIN wins, then PUBLIC_SITE_URL; the site admin's
     * Push → Settings "public origin" overrides both. On localhost OneSignal
     * cannot fetch the image and the push arrives without it.
     */
    PUBLIC_ASSET_ORIGIN: coercers.optionalStr(),
    PUBLIC_SITE_URL: coercers.optionalStr(),

    /**
     * OneSignal keys from the env, used when the site admin's Features → Push
     * notifications fields are blank (a value saved there wins). The owner
     * panel must still switch push_notifications on with the OneSignal variant.
     */
    ONESIGNAL_APP_ID: coercers.optionalStr(),
    ONESIGNAL_API_KEY: coercers.optionalStr(),
  },
  { serviceDir: path.resolve(__dirname, '..') }
);

config.SERVICE_NAME = 'admin-service';
config.PORT = config.ADMIN_SERVICE_PORT;

module.exports = config;
