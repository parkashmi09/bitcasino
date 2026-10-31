'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../src');
const { createLogger } = require('@ibitplay/common');
const { unwrapArtwork, usableArtwork, artworkFor, recoveredArtwork } = require('../seeders/data/artwork');
const migration = require('../migrations/092-game-artwork-recovery');

/**
 * Game artwork: the wrappers seeder 004 threw away, and migration 092 filling them into an
 * imported catalogue without touching an image the site admin set.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

test('game artwork recovery', async (t) => {
  await t.test('a Next image proxy and a Drive share link unwrap to the file itself', () => {
    const proxied =
      'https://boxbet.io/_next/image?url=https%3A%2F%2Fcdn.softswiss.net%2Fi%2Fs6%2Fevolution%2Froulette_rng.png&w=640&q=100';
    assert.equal(unwrapArtwork(proxied), 'https://cdn.softswiss.net/i/s6/evolution/roulette_rng.png');
    assert.equal(
      unwrapArtwork('https://drive.google.com/open?id=1-MXC53e1AIjMxlUPMklHhTiiGNWDrfgC&usp=drive_copy'),
      'https://drive.google.com/uc?export=view&id=1-MXC53e1AIjMxlUPMklHhTiiGNWDrfgC'
    );
    assert.equal(
      unwrapArtwork('https://drive.google.com/file/d/abc_DEF-1/view?usp=sharing'),
      'https://drive.google.com/uc?export=view&id=abc_DEF-1'
    );
    assert.equal(unwrapArtwork('https://www.coincasino.com/a.jpg'), 'https://www.coincasino.com/a.jpg');
    assert.equal(unwrapArtwork('https://x.test/_next/image?url=javascript%3Aalert(1)'), 'https://x.test/_next/image?url=javascript%3Aalert(1)');
  });

  await t.test('the wrapper itself is not drawable, what it wraps is', () => {
    assert.equal(usableArtwork('https://boxbet.io/_next/image?url=x'), false);
    assert.equal(usableArtwork('https://drive.google.com/open?id=abc'), false);
    assert.equal(usableArtwork('https://drive.google.com/uc?export=view&id=abc'), false, 'Drive refuses <img> requests');
    assert.equal(usableArtwork('https://bc.imgix.net/game/image/1.png'), false);
    assert.equal(usableArtwork(''), false);
  });

  await t.test('artworkFor: own URL, else the verified recovery, else null', () => {
    const recovered = { u1: 'https://cdn.softswiss.net/i/s6/bgaming/RocketDice.png' };
    assert.equal(artworkFor({ game_uid: 'u0', game_icon: 'https://www.coincasino.com/a.jpg' }, recovered), 'https://www.coincasino.com/a.jpg');
    assert.equal(artworkFor({ game_uid: 'u1', game_icon: 'https://bc.imgix.net/x.png' }, recovered), recovered.u1);
    assert.equal(artworkFor({ game_uid: 'u1', game_icon: '' }, recovered), recovered.u1);
    assert.equal(
      artworkFor({ game_uid: 'u2', game_icon: 'https://boxbet.io/_next/image?url=https%3A%2F%2Fcdn.softswiss.net%2Fa.png' }, {}),
      null,
      'an unwrapped URL nobody verified is not used'
    );
    assert.equal(artworkFor({ game_uid: 'u3', game_icon: 'https://example.com/a.png' }, {}), null);
  });

  await t.test('the shipped recovery file holds only absolute https image URLs', () => {
    const entries = Object.entries(recoveredArtwork());
    assert.ok(entries.length > 400, `expected the verified recoveries, got ${entries.length}`);
    for (const [uid, url] of entries) {
      assert.match(uid, /^[0-9a-f]{32}$/);
      assert.ok(usableArtwork(url) && url.startsWith('https://'), url);
    }
    assert.ok(migration.recoveredPairs().length >= entries.length);
  });

  const logger = createLogger({ name: '092-test', level: 'silent' });
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  t.after(() => connection.close());
  const { sequelize } = connection;

  await t.test('092 fills an empty image and never replaces one the admin set', async () => {
    const [[a], [b]] = migration.recoveredPairs();
    const transaction = await sequelize.transaction();
    try {
      for (const uid of [a, b]) {
        await sequelize.query('DELETE FROM gisgamesnew WHERE uuid = $1', { bind: [uid], transaction });
      }
      await sequelize.query(
        `INSERT INTO gisgamesnew (uuid, name, provider, image) VALUES ($1, 'A', 'p', NULL), ($2, 'B', 'p', 'https://admin.test/b.png')`,
        { bind: [a, b], transaction }
      );
      await migration.up({ sequelize, transaction, logger });
      await migration.up({ sequelize, transaction, logger });
      const [rows] = await sequelize.query('SELECT uuid, image FROM gisgamesnew WHERE uuid IN ($1, $2)', {
        bind: [a, b],
        transaction,
      });
      const image = Object.fromEntries(rows.map((r) => [r.uuid, r.image]));
      assert.equal(image[a], migration.recoveredPairs()[0][1]);
      assert.equal(image[b], 'https://admin.test/b.png');

      await migration.down({ sequelize, transaction, logger });
      const [after] = await sequelize.query('SELECT uuid, image FROM gisgamesnew WHERE uuid IN ($1, $2)', {
        bind: [a, b],
        transaction,
      });
      const back = Object.fromEntries(after.map((r) => [r.uuid, r.image]));
      assert.equal(back[a], null);
      assert.equal(back[b], 'https://admin.test/b.png');
    } finally {
      await transaction.rollback();
    }
  });
});
