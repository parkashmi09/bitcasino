'use strict';

/**
 * The operator's settings, for the services that act on them.
 *
 * ── WHY THIS ASKS admin-service ──────────────────────────────────────────
 *
 * `RACE_TIMEZONE`, `DEPOSIT_MAXIMUM` and their like are what the operator of a
 * site decides, and since migration 049 they live in `siteconfig.settings`,
 * edited from the site admin. `siteconfig` is in the `admin` model domain, so
 * the other services cannot read it — they ask
 * `GET /internal/admin/site-config/settings`, which answers one value per key,
 * ALREADY RESOLVED: the stored one where the operator set it, the deployed
 * environment variable where they did not.
 *
 * ── `value()` IS SYNCHRONOUS, ON PURPOSE ─────────────────────────────────
 *
 * The readers are in the middle of synchronous code — a timezone inside a date
 * calculation, a limit inside an assertion. `value(key, fallback)` answers
 * from the last read and starts a refresh when that read is older than the
 * TTL, so a saved setting is live within seconds and nothing became async to
 * get it. `read()` is there for a caller that would rather wait.
 *
 * ── AND THE FALLBACK IS WHAT THE SERVICE DID BEFORE ──────────────────────
 *
 * Before the first answer, and whenever admin-service cannot be reached, the
 * caller's own fallback is used — its typed config, which is the environment
 * variable it read until now. An outage in admin-service never changes a
 * limit; it only delays a change to one.
 */

const DEFAULT_TTL_MS = 15_000;
const READERS = new WeakMap();

function operatorSettings({ clients, logger, config } = {}) {
  const client = clients?.admin;
  if (!client || typeof client.get !== 'function') return { value: (_key, fallback) => fallback, read: async (_key, fallback) => fallback, refresh: async () => null };

  // One cache per admin client, so every service class in a process shares it.
  if (READERS.has(client)) return READERS.get(client);

  const ttlMs = Number(config?.OPERATOR_SETTINGS_TTL_MS ?? DEFAULT_TTL_MS);
  let cached = { values: null, expires: 0 };
  let inFlight = null;

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = client
      .get('/internal/admin/site-config/settings')
      .then((body) => {
        const values = body?.data ?? body ?? null;
        cached = { values: values && typeof values === 'object' ? values : null, expires: Date.now() + ttlMs };
        return cached.values;
      })
      .catch((error) => {
        // Keep the last good answer, and do not ask again until the TTL passes
        // — a sustained outage must not become a call per request.
        logger?.warn({ err: error.message }, 'Could not read the operator settings — using the last known values');
        cached = { values: cached.values, expires: Date.now() + ttlMs };
        return cached.values;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const pick = (values, key, fallback) => {
    const found = values?.[key];
    return found === undefined || found === null || found === '' ? fallback : found;
  };

  const reader = {
    value(key, fallback) {
      if (cached.expires <= Date.now()) refresh().catch(() => {});
      return pick(cached.values, key, fallback);
    },
    async read(key, fallback) {
      const values = cached.expires > Date.now() ? cached.values : await refresh();
      return pick(values, key, fallback);
    },
    refresh,
  };

  READERS.set(client, reader);
  refresh().catch(() => {}); // warm, so the first `value()` is rarely the fallback
  return reader;
}

module.exports = { operatorSettings };
