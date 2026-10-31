'use strict';

const { SportsbookService } = require('./sportsbook.service');
const { SlotegratorClient } = require('../gis/provider/slotegrator');

/**
 * Assemble the sportsbook service.
 *
 * ── ITS OWN CLIENT, NOT THE GIS ONE ──────────────────────────────────────
 *
 * Same vendor and the same signing scheme, but a DIFFERENT merchant account
 * and a different base URL:
 *
 *     casino     gis.slotegrator.com          M_ID 9088a821…
 *     sportsbook gis-betting-stage.stgr.pw    M_ID 856e1604…
 *
 * Sharing one client would sign sportsbook calls with the casino key, and every
 * request would come back 401. The `SlotegratorClient` class is shared — the
 * protocol is identical and one implementation of it is the point — but each
 * integration gets its own instance holding its own credentials.
 *
 * Note the base URL: `-stage`. The credentials in the legacy source are for the
 * provider's STAGING environment, which is consistent with the module never
 * having been mounted. Production values go in `SPORTSBOOK_BASE_URL`.
 *
 * One instance per container, cached against `deps`, because the client holds
 * the outbound rate-limit gate — three routers building three clients is three
 * times the request rate the provider allows.
 */
const CLIENTS = new WeakMap();

function providerFor(deps) {
  if (CLIENTS.has(deps)) return CLIENTS.get(deps);

  const client = new SlotegratorClient({
    baseUrl: deps.config.SPORTSBOOK_BASE_URL,
    merchantId: deps.config.SPORTSBOOK_MERCHANT_ID,
    merchantKey: deps.config.SPORTSBOOK_MERCHANT_KEY,
    timeoutMs: deps.config.SPORTSBOOK_TIMEOUT_MS,
    rateLimitMs: deps.config.SPORTSBOOK_RATE_LIMIT_MS,
    logger: deps.logger,
    fetchImpl: deps.fetchImpl,
  });

  CLIENTS.set(deps, client);
  return client;
}

/**
 * One service instance per `deps` too.
 *
 * The service holds the book-list cache. A fresh instance per router would give
 * each router its own cache and multiply the upstream calls the cache exists to
 * prevent.
 */
const SERVICES = new WeakMap();

function buildSportsbookService(deps) {
  if (SERVICES.has(deps)) return SERVICES.get(deps);

  const service = new SportsbookService({
    ...deps,
    provider: deps.provider ?? providerFor(deps),
  });

  SERVICES.set(deps, service);
  return service;
}

module.exports = { buildSportsbookService, providerFor };
