'use strict';

const { GamesService } = require('../games/games.service');
const { OriginalGamesService } = require('./originalGames.service');
const { OriginalGamesClient } = require('./provider/client');

const { OgHubProvider } = require('../wl-hub/ogHubProvider');

function buildOriginalGamesService(deps) {
  const { config } = deps;
  return new OriginalGamesService({
    ...deps,
    provider:
      deps.provider ??
      // A whitelabel copy: original games run on the parent's account (modules/wl-hub).
      (config.WHITELABEL_MODE ? new OgHubProvider(deps) : null) ??
      new OriginalGamesClient({
        baseUrl: config.OG_BASE_URL,
        apiKey: config.OG_API_KEY,
        apiSecret: config.OG_API_SECRET,
        webhookSecret: config.OG_WEBHOOK_SECRET,
        timeoutMs: config.OG_TIMEOUT_MS,
        fetchImpl: deps.fetchImpl,
      }),
    // recordActivity / reverseActivity — the stake's VIP, rakeback and affiliate counting.
    games: deps.games ?? new GamesService(deps),
  });
}

module.exports = { buildOriginalGamesService };
