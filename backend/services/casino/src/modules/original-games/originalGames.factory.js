'use strict';

const { GamesService } = require('../games/games.service');
const { OriginalGamesService } = require('./originalGames.service');
const { OriginalGamesClient } = require('./provider/client');

function buildOriginalGamesService(deps) {
  const { config } = deps;
  return new OriginalGamesService({
    ...deps,
    provider:
      deps.provider ??
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
