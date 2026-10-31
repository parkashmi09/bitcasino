#!/usr/bin/env node
'use strict';

/**
 * Fetch the Original Games Aggregator's catalogue (`GET /v1/games`) into `og_games` — what the
 * lobby's Originals row shows. Run on the server after onboarding and whenever the aggregator
 * enables or removes a game:
 *
 *   node scripts/sync-original-games.js
 *
 * Reads casino-service's config (OG_BASE_URL, OG_API_KEY, OG_API_SECRET, OG_WEBHOOK_SECRET, DB_*)
 * from backend/.env. Needs migration 131.
 */

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const config = require('../services/casino/src/config');
const { buildOriginalGamesService } = require('../services/casino/src/modules/original-games/originalGames.factory');

async function main() {
  const logger = createLogger({ name: 'sync-original-games', level: 'warn' });
  const connection = await db.connect({ config, logger, service: 'casino-service' });
  try {
    const service = buildOriginalGamesService({ config, logger, db: connection, models: connection.models, games: {} });
    const { synced, codes } = await service.syncGames();
    console.log(`og_games: ${synced} game(s) — ${codes.join(', ')}`);
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('sync failed:', error.code || '', error.message, error.details ?? '');
  process.exit(1);
});
