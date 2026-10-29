'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ChallengeService, maskName } = require('../challenges.service');

const HOUR = 3600 * 1000;

/** The service over in-memory rows; INR is worth 0.01 USD. */
function service({ challenge } = {}) {
  const winners = [];
  const credits = [];
  const svc = new ChallengeService({
    models: {
      CasinoChallenge: { findAll: async () => [challenge] },
      CasinoChallengeWinner: {
        count: async () => winners.length,
        create: async (row) => {
          if (winners.some((w) => w.user_id === row.user_id)) throw Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' });
          const saved = { ...row, id: winners.length + 1 };
          winners.push(saved);
          return saved;
        },
        update: async () => {},
      },
    },
    logger: null,
    clients: { user: { get: async () => [{ currency: 'INR', usdRate: '0.01' }] } },
    wallet: { credit: async (c) => { credits.push(c); return { ledgerId: credits.length }; } },
  });
  return { svc, winners, credits };
}

const base = {
  id: 1, game: 'limbo', game_name: 'Limbo', min_multiplier: '100.0000', min_bet_usd: '1.00', prize_usd: '50.00', winners: 2,
  starts_at: new Date(Date.now() - HOUR), ends_at: new Date(Date.now() + HOUR), status: 'ACTIVE',
};

test('a qualifying round wins and is paid in the coin it was bet in', async () => {
  const { svc, winners, credits } = service({ challenge: base });
  // 200 INR = $2 at a 150x multiplier (profit = 149 x stake).
  await svc.onSettled({ userId: '7', game: 'limbo', coin: 'INR', amount: '200', profit: '29800', betId: 'b1' });
  assert.equal(winners.length, 1);
  assert.equal(credits[0].currency, 'INR');
  assert.equal(credits[0].amount, '5000.00000000'); // $50 at 0.01
});

test('too low a multiplier or too small a bet does not win', async () => {
  const { svc, winners } = service({ challenge: base });
  await svc.onSettled({ userId: '7', game: 'limbo', coin: 'INR', amount: '200', profit: '1000', betId: 'b1' }); // 6x
  await svc.onSettled({ userId: '7', game: 'limbo', coin: 'INR', amount: '50', profit: '50000', betId: 'b2' }); // $0.50
  assert.equal(winners.length, 0);
});

test('a player wins a challenge once, and the winner count caps it', async () => {
  const { svc, winners } = service({ challenge: base });
  const big = { game: 'limbo', coin: 'INR', amount: '200', profit: '29800' };
  await svc.onSettled({ ...big, userId: '7', betId: 'b1' });
  await svc.onSettled({ ...big, userId: '7', betId: 'b2' });
  await svc.onSettled({ ...big, userId: '8', betId: 'b3' });
  await svc.onSettled({ ...big, userId: '9', betId: 'b4' });
  assert.deepEqual(winners.map((w) => w.user_id), ['7', '8']);
});

test('names are masked on the public list', () => {
  assert.equal(maskName('demoplayer'), 'demo...');
});
