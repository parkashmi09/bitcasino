'use strict';

const { JsGamesService } = require('./jsGames.service');
const { HuiduClient } = require('./providers/huidu');
const { XGamesApiClient } = require('./providers/xgamesApi');

/**
 * Assemble the jsGames service.
 *
 * Four routers need one. Built once per container so the two provider clients
 * are shared rather than reconstructed per router — the same reason `gis` does
 * it, and here it also means one place holds the AES key.
 */
const SERVICES = new WeakMap();

function buildJsGamesService(deps) {
  if (deps.jsGamesService) return deps.jsGamesService;
  if (SERVICES.has(deps)) return SERVICES.get(deps);

  const service = new JsGamesService({
    ...deps,
    v1:
      deps.v1 ??
      new HuiduClient({
        baseUrl: deps.config.JSGAMES_V1_BASE_URL,
        agencyUid: deps.config.JSGAMES_V1_AGENCY_UID,
        aesKey: deps.config.JSGAMES_V1_AES_KEY,
        playerPrefix: deps.config.JSGAMES_V1_PLAYER_PREFIX,
        timeoutMs: deps.config.JSGAMES_TIMEOUT_MS,
        logger: deps.logger,
        fetchImpl: deps.fetchImpl,
      }),
    v2:
      deps.v2 ??
      new XGamesApiClient({
        baseUrl: deps.config.JSGAMES_V2_BASE_URL,
        userBaseUrl: deps.config.JSGAMES_V2_USER_BASE_URL,
        apiKey: deps.config.JSGAMES_V2_API_KEY,
        apiSecret: deps.config.JSGAMES_V2_API_SECRET,
        timeoutMs: deps.config.JSGAMES_TIMEOUT_MS,
        maxSkewSeconds: deps.config.JSGAMES_MAX_SKEW_SECONDS,
        logger: deps.logger,
        fetchImpl: deps.fetchImpl,
      }),
  });

  SERVICES.set(deps, service);
  return service;
}

module.exports = { buildJsGamesService };
