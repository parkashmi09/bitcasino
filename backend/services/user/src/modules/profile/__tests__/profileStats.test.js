'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { ProfileStatsService, buildProfileStats, TTL_MS } = require('../profileStats.service');

/**
 * `GET /user/profile/stats` — the fold of casino-service's and sports-service's
 * answers into USD, and the 60 s cache. No database: both sources and the
 * exchange-rate table are stubbed, so this pins the arithmetic.
 */

const RATES = new Map([['INR', '0.012'], ['BTC', '65000']]);

const CASINO = {
  byCurrency: [
    { section: 'casino', currency: 'INR', wagered: '10000', bets: 40, wins: 12, firstAt: '2026-01-05T00:00:00.000Z', lastAt: '2026-09-01T00:00:00.000Z' },
    { section: 'casino', currency: 'BTC', wagered: '0.001', bets: 5, wins: 1, firstAt: '2026-03-01T00:00:00.000Z', lastAt: '2026-10-01T00:00:00.000Z' },
    { section: 'sports', currency: 'INR', wagered: '500', bets: 2, wins: 1, firstAt: '2026-04-01T00:00:00.000Z', lastAt: '2026-04-02T00:00:00.000Z' },
    { section: 'casino', currency: 'PKR', wagered: '700', bets: 3, wins: 0, firstAt: '2025-12-31T00:00:00.000Z', lastAt: '2026-01-01T00:00:00.000Z' },
  ],
  biggestWins: [
    { currency: 'INR', amount: '5000', game: 'Big Bass', at: '2026-05-01T00:00:00.000Z' },
    { currency: 'BTC', amount: '0.002', game: 'Crash', at: '2026-06-01T00:00:00.000Z' },
  ],
  games: [
    { key: 'gis:a', currency: 'INR', name: 'Big Bass', provider: 'Pragmatic', wagered: '8000', bets: 30 },
    { key: 'gis:b', currency: 'INR', name: 'Aviator', provider: 'Spribe', wagered: '2000', bets: 10 },
    { key: 'inhouse:crash', currency: 'BTC', name: 'crash', provider: null, wagered: '0.001', bets: 5 },
    { key: 'gis:a', currency: 'BTC', name: 'Big Bass', provider: 'Pragmatic', wagered: '0.0001', bets: 1 },
  ],
};
const SPORTS = {
  byCurrency: [{ currency: 'USDT', wagered: '20', usd: '20', bets: 4, wins: 3, firstAt: '2026-02-01T00:00:00.000Z', lastAt: '2026-10-05T00:00:00.000Z' }],
};

test('profile stats: fold into USD', () => {
  const s = buildProfileStats({ casino: CASINO, sports: SPORTS, rates: RATES, asOf: 'now' });

  // INR 10000*.012 = 120, BTC .001*65000 = 65, partner-sportsbook INR 500 = 6, USDT 20. PKR has no rate.
  assert.strictEqual(s.wagered.usd, '211.00000000');
  assert.deepStrictEqual(s.wagered.unrated, ['PKR']);
  assert.strictEqual(s.bets, 54);
  assert.strictEqual(s.wins, 17);
  assert.strictEqual(s.winRate, ((17 / 54) * 100).toFixed(2));

  const inr = s.wagered.byCurrency.find((c) => c.currency === 'INR');
  assert.deepStrictEqual(inr, { currency: 'INR', amount: '10500.00000000', usd: '126.00000000', bets: 42 });
  assert.strictEqual(s.wagered.byCurrency[0].currency, 'INR', 'sorted by USD, largest first');
  assert.strictEqual(s.wagered.byCurrency.find((c) => c.currency === 'PKR').usd, null);

  // The Slotegrator sportsbook row counts as sports, not casino.
  assert.strictEqual(s.sections.sports.wageredUsd, '26.00000000');
  assert.strictEqual(s.sections.sports.bets, 6);
  assert.strictEqual(s.sections.casino.wageredUsd, '185.00000000');

  // BTC 0.002 = $130 beats INR 5000 = $60.
  assert.strictEqual(s.biggestWin.currency, 'BTC');
  assert.strictEqual(s.biggestWin.usd, '130.00000000');

  // Big Bass in two currencies is one game: 96 + 6.5.
  assert.deepStrictEqual(s.favouriteGames.map((g) => [g.name, g.wageredUsd]), [
    ['Big Bass', '102.50000000'], ['crash', '65.00000000'], ['Aviator', '24.00000000'],
  ]);
  assert.deepStrictEqual(s.favouriteProviders.map((p) => p.name), ['Pragmatic', 'Sports', 'Spribe']);

  assert.strictEqual(s.firstBetAt, '2025-12-31T00:00:00.000Z');
  assert.strictEqual(s.lastBetAt, '2026-10-05T00:00:00.000Z');
});

test('profile stats: a player with no bets', () => {
  const s = buildProfileStats({ casino: { byCurrency: [], biggestWins: [], games: [] }, sports: { byCurrency: [] }, rates: RATES, asOf: 'now' });
  assert.strictEqual(s.bets, 0);
  assert.strictEqual(s.winRate, null);
  assert.strictEqual(s.wagered.usd, '0.00000000');
  assert.deepStrictEqual(s.wagered.byCurrency, []);
  assert.strictEqual(s.biggestWin, null);
  assert.deepStrictEqual(s.favouriteGames, []);
  assert.strictEqual(s.firstBetAt, null);
});

function stubService({ casinoFails = false, sportsFails = false } = {}) {
  const calls = { casino: 0, sports: 0, rates: 0 };
  let clock = 1_000_000;
  const service = new ProfileStatsService({
    models: { Exchangerate: { findAll: async () => { calls.rates += 1; return [{ currency: 'INR', usd_rate: '0.012' }]; } } },
    clients: {
      casino: { get: async () => { calls.casino += 1; if (casinoFails) throw new Error('down'); return CASINO; } },
      sports: { get: async () => { calls.sports += 1; if (sportsFails) throw new Error('down'); return SPORTS; } },
    },
    logger: { warn() {} },
    now: () => clock,
  });
  return { service, calls, tick: (ms) => { clock += ms; } };
}

test('profile stats: cached 60 s per player, one computation per burst', async () => {
  const { service, calls, tick } = stubService();
  const [a, b] = await Promise.all([service.forPlayer(7), service.forPlayer(7)]);
  assert.strictEqual(a, b);
  assert.strictEqual(calls.casino, 1);

  tick(TTL_MS - 1);
  await service.forPlayer(7);
  assert.strictEqual(calls.casino, 1, 'still fresh');

  await service.forPlayer(8);
  assert.strictEqual(calls.casino, 2, 'another player is another entry');

  tick(2);
  await service.forPlayer(7);
  assert.strictEqual(calls.casino, 3, 'expired after 60 s');
});

test('profile stats: one source down answers partially and is not cached', async () => {
  const { service, calls } = stubService({ sportsFails: true });
  const s = await service.forPlayer(9);
  assert.deepStrictEqual(s.unavailable, ['sports']);
  assert.strictEqual(s.sections.sports.bets, 2, 'only the partner-sportsbook casino rows');
  await service.forPlayer(9);
  assert.strictEqual(calls.sports, 2, 'retried, not cached');
});

test('profile stats: both sources down is a 503', async () => {
  const { service } = stubService({ casinoFails: true, sportsFails: true });
  await assert.rejects(service.forPlayer(10), (err) => err.statusCode === 503 || err.status === 503);
});

test('profile stats: casino net result and best multiplier (for the medals)', () => {
  const casino = {
    byCurrency: [
      { section: 'casino', currency: 'INR', wagered: '10000', won: '4000', bets: 4, wins: 1, firstAt: null, lastAt: null },
      { section: 'casino', currency: 'USDT', wagered: '10', won: '35', bets: 2, wins: 1, firstAt: null, lastAt: null },
      // No rate: left out of the net, as it is left out of the wagered total.
      { section: 'casino', currency: 'PKR', wagered: '1', won: '99999', bets: 1, wins: 1, firstAt: null, lastAt: null },
    ],
    biggestWins: [],
    games: [],
    maxMultiplier: '12.5000',
  };
  const s = buildProfileStats({ casino, sports: { byCurrency: [] }, rates: RATES, asOf: 'now' });
  // INR: (4000 - 10000) * 0.012 = -72; USDT: +25.
  assert.strictEqual(s.casinoNetUsd, '-47.00000000');
  assert.strictEqual(s.maxMultiplier, '12.5000');

  const none = buildProfileStats({ casino: null, sports: null, rates: RATES, asOf: 'now' });
  assert.strictEqual(none.casinoNetUsd, '0.00000000');
  assert.strictEqual(none.maxMultiplier, null);
});
