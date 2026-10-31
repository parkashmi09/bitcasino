#!/usr/bin/env node
'use strict';

/**
 * Fill the lobby's "Hot Games" row (`hotgames`) — the one curated collection the home page has
 * no category to fall back on, so it stays empty until an operator picks its games.
 *
 *   node scripts/set-hot-games.js            # print what it would set
 *   node scripts/set-hot-games.js --apply    # write it
 *
 * The titles below are the well-known ones, one per studio where the catalogue has them, across
 * crash, slots, live dealer and table — the row is dealt out provider by provider on the page
 * (services/home.js `mixProviders`), so a spread of studios is what makes it mix.
 *
 * Goes through GamesService.setCollection, which verifies every uuid against the catalogue
 * first, exactly as the site admin's PUT /collections/hot does.
 */

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const config = require('../services/casino/src/config');
const { GamesService } = require('../services/casino/src/modules/games/games.service');

/** name (exact), preferred studio — first match in the catalogue wins. */
const WANTED = [
  ['Aviator', 'Spribe'],
  ['Big Bass Bonanza', null],
  ['Book of Dead', 'PlayNGo'],
  ['Starburst', 'NetEnt'],
  ['Sugar Rush Fever', null],
  ["Gonzo's Quest", 'NetEnt'],
  ['Money Train 2', 'Relax Gaming'],
  ['Fruit Party', 'KAGaming'],
  ['Dice Bonanza', 'BGaming'],
  ['Plinko', 'Amarix'],
  ['Mines', 'Turbogames'],
  ['Dragon Tiger', 'OneTouch'],
  ['Andar Bahar', 'XProgaming'],
  ['Teen Patti', 'Ezugi'],
  ['Roulette', 'Vivogaming'],
  ['Blackjack', 'XProgaming'],
  ['Baccarat', 'Ezugi'],
];

async function main() {
  const apply = process.argv.includes('--apply');
  const logger = createLogger({ name: 'set-hot-games', level: 'warn' });
  const connection = await db.connect({ config, logger, service: 'casino-service' });

  try {
    const picked = [];

    for (const [name, provider] of WANTED) {
      const [row] = await connection.sequelize.query(
        `SELECT uuid, name, provider FROM gisgamesnew
          WHERE name = :name ${provider ? 'AND provider = :provider' : ''}
            AND image IS NOT NULL AND image <> ''
          ORDER BY id LIMIT 1`,
        { replacements: { name, provider }, type: connection.QueryTypes.SELECT }
      );

      if (row) picked.push(row);
      else console.log(`  (not in the catalogue: ${name}${provider ? ` [${provider}]` : ''})`);
    }

    for (const g of picked) console.log(`  ${g.name}  [${g.provider}]`);
    console.log(`\n${picked.length} game(s)`);

    if (!apply) return console.log('\nDry run. Re-run with --apply to write it.');

    const service = new GamesService({ models: connection.models, db: connection, config, logger, clients: {} });
    const out = await service.setCollection({ collection: 'hot', uuids: picked.map((g) => g.uuid), actor: { id: 'set-hot-games' } });
    console.log(`\nhotgames: ${out.count} game(s) written`);
  } finally {
    await connection.close();
  }
}

main().catch((e) => {
  console.error('failed:', e.code ?? '', e.message);
  process.exit(1);
});
