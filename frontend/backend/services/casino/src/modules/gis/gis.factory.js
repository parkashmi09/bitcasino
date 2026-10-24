'use strict';

const { GamesService } = require('../games/games.service');
const { GisService } = require('./gis.service');
const { SlotegratorClient } = require('./provider/slotegrator');

/**
 * Assemble the GIS service.
 *
 * Three routers need one, and each is built by its own factory function, so
 * without this each would construct its own `SlotegratorClient` — and the
 * client holds the outbound rate-limit gate. Three gates is three times the
 * request rate the provider allows, which is how a sync starts returning 429s
 * the moment anyone opens a game.
 *
 * One client per container, shared. `deps` is the same object for every router
 * in a service, so it is the natural place to keep it.
 */
const CLIENTS = new WeakMap();

function providerFor(deps) {
  if (CLIENTS.has(deps)) return CLIENTS.get(deps);

  const client = new SlotegratorClient({
    baseUrl: deps.config.GIS_BASE_URL,
    merchantId: deps.config.GIS_MERCHANT_ID,
    merchantKey: deps.config.GIS_MERCHANT_KEY,
    timeoutMs: deps.config.GIS_TIMEOUT_MS,
    rateLimitMs: deps.config.GIS_RATE_LIMIT_MS,
    logger: deps.logger,
    fetchImpl: deps.fetchImpl,
  });

  CLIENTS.set(deps, client);
  return client;
}

function buildGisService(deps) {
  return new GisService({
    ...deps,
    provider: deps.provider ?? providerFor(deps),
    // The launch path records a recently-played entry, and that list belongs to
    // the catalogue module. Reused rather than reimplemented, so there is one
    // definition of "how many we keep".
    games: deps.games ?? new GamesService(deps),
  });
}

module.exports = { buildGisService, providerFor };
