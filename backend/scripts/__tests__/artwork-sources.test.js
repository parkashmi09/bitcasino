'use strict';

/**
 * The matcher `fix-game-artwork.js` trusts: provider map, name normalisation, live-or-not,
 * and the bitcasino source (fetch mocked). No DB, no network.
 *
 *   node --test scripts/__tests__/artwork-sources.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nameKey,
  nameKeys,
  baseName,
  sameProvider,
  rowIsLive,
  categoryOf,
  fromBitcasino,
  importSource,
  BITCASINO_BLOCKED,
  bitcasinoUrl,
  SOURCES,
  setOwnCatalogue,
  fromOwnCatalogue,
} = require('../lib/artwork-sources');
const { portrait } = require('../fix-game-artwork');

test('provider map: Slotegrator names against the references', () => {
  assert.ok(sameProvider('PragmaticPlayLive', 'Pragmatic Play Live'));
  assert.ok(sameProvider('PragmaticPlayLive', 'pragmatic-play'));
  assert.ok(sameProvider('Hacksaw Gaming', 'hacksaw'));
  assert.ok(sameProvider('Evolution Gaming', 'Evolution'));
  assert.ok(sameProvider('Evolution Gaming', 'evolution-hub-asia'));
  assert.ok(sameProvider('Platipus2', 'Platipus'));
  assert.ok(sameProvider('SevenMojos Slots', '7Mojos'));
  assert.ok(sameProvider('PGSoft', 'PG Soft'));
  assert.ok(sameProvider('SA Gaming', 'SA Gaming'));
  // a different studio is never the same provider
  assert.ok(!sameProvider('Hacksaw Gaming', 'Pragmatic Play'));
  assert.ok(!sameProvider('Ezugi', 'Evolution'));
  assert.ok(!sameProvider('Platipus2', ''));
});

test('name normalisation', () => {
  assert.equal(nameKey('Rusty & Curly™'), nameKey('Rusty and Curly'));
  assert.equal(nameKey("Le Bandit's"), 'lebandits');
  assert.equal(baseName('Gladiator Legends 96% Mobile'), 'Gladiator Legends');
  assert.equal(baseName('Wanted Dead or a Wild 88.5 % Desktop'), 'Wanted Dead or a Wild');
  assert.deepEqual(nameKeys('Gladiator Legends 96% Mobile'), ['gladiatorlegends96mobile', 'gladiatorlegends']);
  assert.deepEqual(nameKeys('Sweet Bonanza'), ['sweetbonanza']);
  // a number that is part of the name stays
  assert.equal(baseName('Gates of Olympus 1000'), 'Gates of Olympus 1000');
});

test('live or not', () => {
  assert.equal(rowIsLive({ provider: 'PragmaticPlayLive', type: 'blackjack', name: 'Blackjack 1' }), true);
  assert.equal(rowIsLive({ provider: 'Ezugi', type: 'roulette', name: 'Auto Roulette' }), true);
  assert.equal(rowIsLive({ provider: 'Evolution Gaming', type: 'slots', name: 'Dead or Alive' }), false);
  assert.equal(rowIsLive({ provider: 'Evolution Gaming', type: 'roulette', name: 'First Person Roulette' }), false);
  assert.equal(rowIsLive({ provider: 'Playtech', type: 'live dealer', name: 'Quantum Roulette' }), true);
  assert.equal(rowIsLive({ provider: 'Platipus2', type: 'table', name: 'European Roulette' }), false);
  assert.equal(rowIsLive({ provider: 'Hacksaw Gaming', type: 'slots', name: 'Wanted Dead or a Wild' }), false);
  assert.equal(categoryOf('game show'), 'live');
  assert.equal(categoryOf('baccarat '), 'table');
});

test('bitcasino: matches on all three, portrait art first (mocked fetch)', async (t) => {
  const games = [
    { name: 'Crazy Time', thumbUrl: '//cdn.coingaming.io/x/wide.jpg', thumbUrlTab: 'https://cdn.coingaming.io/8.io+new+thumbs/Crazy Time.png', provider: { name: 'Evolution Hub Asia' }, menuItem: [{ name: 'Evolution' }], category: { name: 'Live Game Shows' } },
    { name: 'Roulette', thumbUrl: '//cdn.hub88.io/x/rng-roulette.jpg', provider: { name: 'Platipus' }, menuItem: [{ name: 'Platipus' }], category: { name: 'Table Games' } },
  ];
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: { casinoGameInventory: { searchGames: { results: games } } } }), { status: 200 }));
  const hit = await fromBitcasino({ name: 'Crazy Time', provider: 'Evolution Gaming', type: 'game show' });
  assert.equal(hit.url, 'https://cdn.coingaming.io/8.io+new+thumbs/Crazy%20Time.png');
  assert.equal(hit.landscape, undefined);
  assert.ok((await fromBitcasino({ name: 'Crazy Time', provider: 'PragmaticPlayLive', type: 'game show' })).miss);
  const rng = await fromBitcasino({ name: 'Roulette', provider: 'Platipus2', type: 'table' });
  assert.equal(rng.url, 'https://cdn.hub88.io/x/rng-roulette.jpg');
  assert.equal(rng.landscape, true);
  assert.ok((await fromBitcasino({ name: 'Roulette', provider: 'Platipus2', type: 'live dealer' })).miss);
});

test('bitcasino: a Cloudflare challenge stops it for the run', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    new Response('<title>Just a moment...</title>', { status: 403, headers: { 'cf-mitigated': 'challenge' } })
  );
  assert.deepEqual(await fromBitcasino({ name: 'Aviator', provider: 'Spribe', type: 'crash' }), { miss: BITCASINO_BLOCKED });
  assert.deepEqual(await fromBitcasino({ name: 'Le Bandit', provider: 'Hacksaw Gaming', type: 'slots' }), { miss: BITCASINO_BLOCKED });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(bitcasinoUrl('//cdn.hub88.io/a b.jpg'), 'https://cdn.hub88.io/a%20b.jpg');
});

test('--import: a user-exported catalogue, same three checks', async () => {
  const from = importSource([
    { name: 'Le Bandit', provider: 'Hacksaw Gaming', category: 'Video Slots', image: '//cdn.example/le bandit.jpg' },
    { name: 'Mega Wheel', provider: 'Pragmatic Play Live', category: 'Live Game Shows', image: 'https://cdn.example/mw.jpg' },
  ]);
  assert.equal((await from({ name: 'Le Bandit Mobile', provider: 'Hacksaw Gaming', type: 'slots' })).url, 'https://cdn.example/le%20bandit.jpg');
  assert.equal((await from({ name: 'Mega Wheel', provider: 'PragmaticPlayLive', type: 'game show' })).source, 'import');
  assert.ok((await from({ name: 'Le Bandit', provider: 'PGSoft', type: 'slots' })).miss);
  assert.equal(importSource([]), null);
});

test('own catalogue: JSGames rows matched on provider, name and live-or-not', async () => {
  assert.deepEqual(await fromOwnCatalogue({ name: 'Le Bandit', provider: 'Hacksaw Gaming', type: 'slots' }), { miss: 'own catalogue not loaded' });
  setOwnCatalogue([
    { name: 'Le Bandit', provider: 'hacksaw', type: 'Slot', image: 'https://cdn.softswiss.net/le-bandit.png' },
    { name: 'Crazy Time', provider: 'evolution', type: 'CasinoLive', image: 'https://imgxcut.com/game/image/ct.png' },
    { name: 'Starburst', provider: 'netent', type: 'Slot Game', image: '0bace5f8418a61a7f6efccabefdb30aa.png' }, // relative: ignored
  ]);
  const hit = await fromOwnCatalogue({ name: 'Le Bandit 96% Mobile', provider: 'Hacksaw Gaming', type: 'slots' });
  assert.equal(hit.source, 'own');
  assert.equal(hit.url, 'https://cdn.softswiss.net/le-bandit.png');
  assert.equal((await fromOwnCatalogue({ name: 'Crazy Time', provider: 'Evolution Gaming', type: 'game show' })).source, 'own');
  // provider mismatch
  assert.ok((await fromOwnCatalogue({ name: 'Le Bandit', provider: 'PGSoft', type: 'slots' })).miss);
  // live mismatch: an RNG row never takes the live table's art
  assert.ok((await fromOwnCatalogue({ name: 'Crazy Time', provider: 'Evolution Gaming', type: 'slots' })).miss);
  assert.deepEqual(await fromOwnCatalogue({ name: 'Starburst', provider: 'NetEnt', type: 'slots' }), { miss: 'not in own catalogue' });
  assert.equal(SOURCES[0], fromOwnCatalogue);
});

test('provider map: the live Slotegrator names', () => {
  assert.ok(sameProvider('No Limit City', 'NoLimitCity'));
  assert.ok(sameProvider('No Limit City', 'nolimit'));
  assert.ok(sameProvider('RTG SLOTS', 'Real Time Gaming'));
  assert.ok(sameProvider('HolleGames Standard', 'Hölle Games'));
  assert.ok(sameProvider('BGaming', 'bgmng'));
  assert.ok(sameProvider('NetEnt', 'netent'));
  assert.ok(!sameProvider('NetEnt', 'Red Tiger'));
});

test('portrait range fits the 3:4 tile', () => {
  assert.ok(portrait({ width: 480, height: 640 }));
  assert.ok(portrait({ width: 400, height: 600 }));
  assert.ok(!portrait({ width: 490, height: 368 }));
  assert.ok(!portrait({ width: 300, height: 300 }));
});
