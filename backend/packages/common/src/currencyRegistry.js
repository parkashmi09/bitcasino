'use strict';

/**
 * The site's coin registry, as every service reads it.
 *
 * admin-service owns the `currencies` table (migration 061): each coin's name,
 * symbol, image, networks and switches. The other services ask it through
 * `GET /internal/admin/currencies`, cached for a few seconds, exactly like the
 * entitlements helper next door. Inside admin-service the reader is the table.
 *
 *   configureCurrencyRegistry({ read })                       // admin-service
 *   configureCurrencyRegistry({ clients, logger, config })    // everyone else
 *
 *   await listCurrencies()      // every coin, effective `enabled` included
 *   await describe('USDT')      // one coin, or null
 *   await isEnabled('USDT')     // owner AND site on, not retired
 *   await networksOf('USDT')    // enabled networks [{ key, name }]
 *   await disabledCodes()       // Set of the codes switched off now
 *   await assertCurrencyEnabled('USDT')   // 422 CURRENCY_DISABLED when off
 *
 * ── FAILS OPEN, LIKE ENTITLEMENTS ──────────────────────────────────────────
 * No reader, or admin-service unreachable with no copy yet: `listCurrencies()`
 * is `[]`, `describe()` is null and `isEnabled()` is TRUE. A registry hiccup
 * must not switch the cashier off; the wallet's own allow-list
 * (`CURRENCY_COLUMN`, RETIRED_CURRENCIES) still decides what can move.
 *
 * The registry is display and switches only. It never turns a code into a
 * `credits` column.
 */

const { AppError } = require('./errors');

const DEFAULT_TTL_MS = 5_000;

/** A currency code: uppercase letter, then 1–9 uppercase letters or digits. */
const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

let reader = null;

function normaliseList(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.currencies) ? value.currencies : null;
  return list ? list.filter((c) => c && typeof c.code === 'string') : null;
}

function configureCurrencyRegistry({ read, clients, logger, config } = {}) {
  if (typeof read === 'function') {
    const ttlMs = Number(config?.CURRENCY_REGISTRY_TTL_MS ?? 2_000);
    let cached = { value: null, expires: 0 };
    reader = {
      local: true,
      invalidate() {
        cached = { value: cached.value, expires: 0 };
      },
      async get() {
        if (cached.expires > Date.now()) return cached.value;
        try {
          cached = { value: normaliseList(await read()) ?? cached.value, expires: Date.now() + ttlMs };
        } catch (error) {
          logger?.warn({ err: error.message }, 'Could not read the currency registry — using the last copy');
          cached = { value: cached.value, expires: Date.now() + ttlMs };
        }
        return cached.value;
      },
    };
    return;
  }
  // dev:mono builds several containers in one process; the table reader wins there.
  if (reader?.local) return;

  const client = clients?.admin;
  if (!client || typeof client.get !== 'function') {
    reader = null;
    return;
  }

  const ttlMs = Number(config?.CURRENCY_REGISTRY_TTL_MS ?? DEFAULT_TTL_MS);
  let cached = { value: null, expires: 0 };
  let inFlight = null;

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = client
      .get('/internal/admin/currencies')
      .then((body) => {
        const value = normaliseList(body?.data ?? body);
        cached = { value: value ?? cached.value, expires: Date.now() + ttlMs };
        return cached.value;
      })
      .catch((error) => {
        logger?.warn({ err: error.message }, 'Could not read the currency registry — using the last known copy');
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
      return cached.expires > Date.now() ? cached.value : refresh();
    },
  };
}

/** Every coin the registry knows (`[]` when it cannot be read). Never throws. */
async function listCurrencies() {
  if (!reader) return [];
  try {
    return (await reader.get()) ?? [];
  } catch {
    return [];
  }
}

/** One coin's registry entry, or null (unknown code, or no registry). */
async function describe(code) {
  const upper = String(code ?? '').trim().toUpperCase();
  if (!CODE_PATTERN.test(upper)) return null;
  return (await listCurrencies()).find((c) => c.code === upper) ?? null;
}

/**
 * Whether players may use this coin now. A coin the registry does not list
 * reads as enabled (fails open), so this only ever narrows the wallet's own
 * allow-list.
 */
async function isEnabled(code) {
  const coin = await describe(code);
  return coin ? coin.enabled !== false : true;
}

/**
 * The codes the registry says are switched off (owner, site or retired), as a
 * Set. Empty when the registry cannot be read — fails open like `isEnabled`.
 * One read for a whole balance list, rather than one `isEnabled` per coin.
 */
async function disabledCodes() {
  return new Set((await listCurrencies()).filter((c) => c.enabled === false).map((c) => c.code));
}

/**
 * Money rails only: refuse with 503 when a registry is configured but no copy of
 * it can be read (admin-service down, nothing cached yet). Failing open here let a
 * player move a coin the owner switched off during an outage. Display paths keep
 * the fail-open `isEnabled` / `listCurrencies`.
 */
async function assertRegistryReadable() {
  if (!reader) return;
  let list = null;
  try {
    list = await reader.get();
  } catch {
    list = null;
  }
  if (!list) throw new AppError('The coin list could not be checked right now — try again shortly', 503, 'CURRENCY_REGISTRY_UNAVAILABLE');
}

/**
 * Refuse a coin the registry has switched off: 422 `CURRENCY_DISABLED`. For
 * the paths that put money INTO a coin or start a payment in it (deposits,
 * payment orders, vault-in, withdrawals). Taking money OUT of a switched-off
 * coin (a swap from it, a bet already settled) is left to the caller. A registry
 * outage is refused (503, `assertRegistryReadable`); an unknown code passes.
 */
async function assertCurrencyEnabled(code) {
  await assertRegistryReadable();
  if (await isEnabled(code)) return;
  const currency = String(code ?? '').trim().toUpperCase();
  throw new AppError(`${currency} is switched off on this site`, 422, 'CURRENCY_DISABLED', { currency });
}

/**
 * The networks a coin may be deposited / withdrawn on: `[{ key, name }]`,
 * enabled ones only. `null` when the registry has no entry for the coin (the
 * caller keeps its own list).
 */
async function networksOf(code) {
  const coin = await describe(code);
  if (!coin) return null;
  return (Array.isArray(coin.networks) ? coin.networks : [])
    .filter((n) => n && n.enabled !== false)
    .map(({ key, name }) => ({ key, name: name || key }));
}

/** Drop the cached copy; the next read asks again (after a registry change). */
function invalidateCurrencyRegistry() {
  reader?.invalidate?.();
}

/** Tests: forget the reader. */
function resetCurrencyRegistry() {
  reader = null;
}

module.exports = {
  CURRENCY_CODE_PATTERN: CODE_PATTERN,
  configureCurrencyRegistry,
  listCurrencies,
  describe,
  isEnabled,
  disabledCodes,
  assertCurrencyEnabled,
  assertRegistryReadable,
  networksOf,
  invalidateCurrencyRegistry,
  resetCurrencyRegistry,
};
