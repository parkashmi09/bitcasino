'use strict';

/**
 * Entitlements — what the platform owner allows this site to run.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHERE THE ANSWER COMES FROM
 *
 * The owner panel (never handed to the client) decides and sends each signed
 * version to admin-service, which stores it in `owner_entitlements` and loads
 * it from there at boot and on every change — see
 * `services/admin/src/modules/entitlements/entitlements.store.js`. Every other
 * service asks admin-service, `GET /internal/admin/entitlements`, through this
 * one helper, cached a few seconds. admin-service itself registers its
 * in-process copy with `configureEntitlements({ read })`, so the same calls
 * work there without a loopback request.
 *
 * The site's own choices (`site_features`, `siteconfig`) stay as they are;
 * effective = entitled AND enabled by the site, so an entitlement switched
 * back on restores the client's own setting.
 *
 * ── FAILS OPEN, LIKE `operatorSettings` ──────────────────────────────────
 *
 * Unconfigured, or admin-service unreachable with no earlier answer: every
 * key reads as entitled — today's behaviour. An answer once received is kept
 * through an outage. A key MISSING from the document is entitled too, so a
 * new catalogue key never breaks a live site.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { defineErrors } = require('./defineErrors');
const { featureByKey } = require('./featureCatalogue');
const { resolveOptions } = require('./featureOptions');

/**
 * Short on purpose: admin-service applies an owner save at once (and its
 * push drops this cache, `invalidateEntitlements`), and a player route in
 * another service should follow within seconds, not another 15. One small internal GET
 * per service every few seconds at most, de-duplicated while in flight.
 */
const DEFAULT_TTL_MS = 3_000;

/**
 * Namespace `NOT`, key `ENTITLED`: the wire code is exactly `NOT_ENTITLED`, the
 * one the owner-panel contract names and the site admin branches on. Details
 * are `{ kind: 'feature' | 'flag', key }`.
 */
const errors = defineErrors('NOT', {
  ENTITLED: { status: 403, message: 'This is not included in your plan' },
});

/** Everything entitled: no copy of the owner's document at all. */
function defaultEntitlements() {
  return { features: {}, flags: {}, version: 0, fetchedAt: null, source: 'default' };
}

let reader = null;

/**
 * Point this process at its source of entitlements. Called once per service,
 * from its container.
 *
 * @param {object}   options
 * @param {Function} [options.read]   a local source (admin-service's store);
 *                                    wins over `clients` and is never replaced by them
 * @param {object}   [options.clients] needs `clients.admin`
 */
function configureEntitlements({ read, clients, logger, config } = {}) {
  if (typeof read === 'function') {
    reader = { local: true, get: async () => (await read()) ?? defaultEntitlements() };
    return;
  }
  // dev:mono builds several containers in one process; the store's copy is the truth there.
  if (reader?.local) return;

  const client = clients?.admin;
  if (!client || typeof client.get !== 'function') {
    reader = null;
    return;
  }

  const ttlMs = Number(config?.ENTITLEMENTS_TTL_MS ?? DEFAULT_TTL_MS);
  let cached = { value: null, expires: 0 };
  let inFlight = null;

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = client
      .get('/internal/admin/entitlements')
      .then((body) => {
        const value = body?.data ?? body ?? null;
        cached = { value: value && typeof value === 'object' ? value : cached.value, expires: Date.now() + ttlMs };
        return cached.value;
      })
      .catch((error) => {
        // Keep the last answer; do not ask again until the TTL passes.
        logger?.warn({ err: error.message }, 'Could not read the entitlements — using the last known copy');
        cached = { value: cached.value, expires: Date.now() + ttlMs };
        return cached.value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  reader = {
    local: false,
    invalidate() {
      cached = { value: cached.value, expires: 0 };
    },
    async get() {
      const value = cached.expires > Date.now() ? cached.value : await refresh();
      return value ?? defaultEntitlements();
    },
  };
}

/** `{ features, flags, version, fetchedAt, source }`. Never throws. */
async function getEntitlements() {
  if (!reader) return defaultEntitlements();
  try {
    const doc = await reader.get();
    return { ...defaultEntitlements(), ...doc, features: doc?.features ?? {}, flags: doc?.flags ?? {} };
  } catch {
    return defaultEntitlements();
  }
}

/**
 * Why `key` is outside the plan in `doc`, or null when it is in it.
 *
 * A feature with a linked siteconfig flag (`featureCatalogue` `flag`, e.g.
 * gift_cards → giftcards) is out when EITHER is false: the owner panel shows
 * them as two rows, and unticking only the product flag must close the
 * player API too, not just hide the page.
 */
function featureRefusal(doc, key) {
  if (doc.features?.[key] === false) return { kind: 'feature', key };
  const flag = featureByKey(key)?.flag;
  if (flag && doc.flags?.[flag] === false) return { kind: 'flag', key: flag };
  return null;
}

/** Sync form for code that already holds the document (list screens, masks). */
function isFeatureEntitledIn(doc, key) {
  return featureRefusal(doc ?? {}, key) === null;
}

/** `false` only when the owner explicitly took the feature (or its linked flag) out of the plan. */
async function isFeatureEntitled(key) {
  return isFeatureEntitledIn(await getEntitlements(), key);
}

/* Flags that read OFF when the owner never set them (owner-panel DEFAULT_OFF_FLAGS): the
   sportsbook replaces the exchange, so it is never on by default; idle logout signs players out. */
const DEFAULT_OFF_FLAGS = new Set(['sportsbook', 'idle_logout']);

/**
 * Sync flag read for code that holds the document. Sports runs one mode at a time: with the
 * sportsbook on, `sportsexchange` reads off whatever is stored, so every exchange gate closes.
 */
function flagOnIn(doc, key) {
  const value = doc?.flags?.[key];
  const on = value === undefined ? !DEFAULT_OFF_FLAGS.has(key) : value !== false;
  return key === 'sportsexchange' ? on && !flagOnIn(doc, 'sportsbook') : on;
}

async function isFlagEntitled(key) {
  return flagOnIn(await getEntitlements(), key);
}

async function assertFeatureEntitled(key) {
  const refusal = featureRefusal(await getEntitlements(), key);
  if (refusal) throw errors.ENTITLED(refusal);
}

async function assertFlagEntitled(key) {
  if (!(await isFlagEntitled(key))) throw errors.ENTITLED({ kind: 'flag', key });
}

/** Express guard for a player route: the feature must be in the plan. */
function requireFeature(key) {
  return function requireFeatureEntitled(_req, _res, next) {
    assertFeatureEntitled(key).then(() => next(), next);
  };
}

/** Express guard for a player route: the siteconfig flag must be in the plan. */
function requireFlag(key) {
  return function requireFlagEntitled(_req, _res, next) {
    assertFlagEntitled(key).then(() => next(), next);
  };
}

/**
 * Drop the cached copy so the next check asks admin-service again. Called when
 * admin-service pushes a change (user-service's site-config push), so player
 * routes follow an owner save at once. The last answer is kept for an outage.
 */
/**
 * A feature's owner-only options (featureOptions.js), defaults filled in. Never throws: an
 * unreadable plan reads as the defaults, which are the site's long-standing behaviour.
 */
async function featureOptions(key) {
  return resolveOptions(await getEntitlements(), key);
}

function invalidateEntitlements() {
  reader?.invalidate?.();
}

/** Tests only: forget the configured source. */
function resetEntitlements() {
  reader = null;
}

module.exports = {
  configureEntitlements,
  getEntitlements,
  isFeatureEntitled,
  isFeatureEntitledIn,
  isFlagEntitled,
  flagOnIn,
  assertFeatureEntitled,
  assertFlagEntitled,
  requireFeature,
  requireFlag,
  featureOptions,
  invalidateEntitlements,
  resetEntitlements,
  defaultEntitlements,
  entitlementErrors: errors,
};
