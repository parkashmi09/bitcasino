'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { BetHistoryService } = require('../betHistory.service');

/**
 * The public ticker / top wins fold third-party legs into rounds beside the in-house bets.
 * No database: each model is a stub that answers its fixed rows.
 */
const stub = (rows) => ({ findAll: async () => rows });
const ago = (ms) => new Date(Date.now() - ms);

const v2 = (type, round, bet, win, at, extra = {}) => ({
  transaction_type: type,
  amount: type === 'bet' ? `-${bet}` : String(win - bet),
  currency: 'INR',
  game_uid: 'aviator-uid',
  game_name: 'Aviator',
  external_transaction_id: round,
  created_at: at,
  additional_data: { game_round: round, bet_amount: String(bet), win_amount: String(win), ...extra },
});

function build() {
  return new BetHistoryService({
    models: {
      // topWins asks the database for `profit > 0`; this losing bet would not come back.
      Bets: { findAll: async ({ where }) => (where?.profit ? [] : [{ gid: 1, game: 'limbo', amount: '10', profit: '-10', coin: 'inr', created: ago(5_000) }]) },
      GameTransaction: stub([
        v2('bet_result', 'won', 10, 25, ago(1_000)),
        v2('bet', 'won', 10, 0, ago(2_000)),
        v2('bet', 'lost', 10, 0, ago(120_000)), // a losing spin never gets a second leg
        v2('bet', 'in-flight', 10, 0, ago(3_000)), // stake only, still inside the grace window
      ]),
      JsGames: stub([{ game_uid: 'aviator-uid', game_name: 'Aviator', vendor: 'Spribe' }]),
    },
    logger: { warn() {} },
  });
}

test('the ticker carries provider rounds beside in-house bets, newest first', async () => {
  const rows = await build().liveFeed({ limit: 10 });
  assert.deepEqual(rows.map((r) => r.game), ['aviator-uid', 'limbo', 'aviator-uid']);
  const won = rows[0];
  assert.equal(won.title, 'Aviator');
  assert.equal(won.amount, '10');
  assert.equal(won.profit, '15');
  assert.equal(won.outcome, 'WIN');
  assert.equal(won.currency, 'INR');
  assert.equal(rows[2].profit, '-10');
  assert.ok(!rows.some((r) => r.reference === 'in-flight'), 'an open round is not a public loss');
});

test('top wins ranks provider wins with in-house ones and drops losses', async () => {
  const rows = await build().topWins({ limit: 10 });
  assert.deepEqual(rows.map((r) => [r.game, r.profit]), [['aviator-uid', '15']]);
});

/** Slotegrator (`gis_transactions`): signed legs keyed by `round_id`, `action` bet / win / refund. */
const gis = (action, round, amount, at, extra = {}) => ({
  action,
  amount: String(amount),
  currency: 'USDT',
  game_uuid: 'cd33-aviator',
  round_id: round,
  transaction_id: `${round}-${action}`,
  finished: null,
  created_at: at,
  ...extra,
});

function buildGis() {
  return new BetHistoryService({
    models: {
      Bets: { findAll: async () => [] },
      GisTransactions: stub([
        gis('win', 'r-won', '2.55', ago(1_000), { finished: true }),
        gis('bet', 'r-won', '-1', ago(2_000)),
        gis('refund', 'r-void', '1', ago(3_000)),
        gis('bet', 'r-void', '-1', ago(4_000)),
        gis('bet', 'r-lost', '-2', ago(120_000)), // a losing spin's zero win is never stored
      ]),
      Gisgamesnew: stub([{ uuid: 'cd33-aviator', name: 'Aviator', provider: 'Spribe', type: 'crash', image: 'https://cdn/aviator.png' }]),
    },
    logger: { warn() {} },
  });
}

test('slotegrator rounds reach the ticker and top wins with their name, art and tab', async () => {
  const live = await buildGis().liveFeed({ limit: 10 });
  assert.deepEqual(live.map((r) => [r.reference, r.profit]), [['r-won', '1.55'], ['r-lost', '-2']]);
  assert.equal(live[0].title, 'Aviator');
  assert.equal(live[0].image, 'https://cdn/aviator.png');
  assert.equal(live[0].category, 'slots');

  const top = await buildGis().topWins({ limit: 10 });
  assert.deepEqual(top.map((r) => [r.title, r.amount, r.profit, r.currency, r.image]), [
    ['Aviator', '1', '1.55', 'USDT', 'https://cdn/aviator.png'],
  ]);
});

test('the public feeds name only players whose Preferences allow it, and carry the studio', async () => {
  const svc = new BetHistoryService({
    models: {
      Bets: stub([
        { gid: 1, uid: 7, game: 'limbo', amount: '1', profit: '1', coin: 'usdt', created: ago(1_000) },
        { gid: 2, uid: 8, game: 'dice', amount: '1', profit: '1', coin: 'usdt', created: ago(2_000) },
      ]),
      GameTransaction: stub([{ ...v2('bet_result', 'r1', 10, 25, ago(3_000)), user_id: 7 }]),
      JsGames: stub([{ game_uid: 'aviator-uid', game_name: 'Aviator', vendor: 'Spribe' }]),
      Users: stub([{ id: 7, name: 'alice' }, { id: 8, name: 'bob' }]),
      // bob switched off Show Bets Publicly (or Hide Username on)
      Userconfig: stub([{ uid: 8 }]),
    },
    logger: { warn() {} },
  });
  for (const rows of [await svc.liveFeed({ limit: 10 }), await svc.topWins({ limit: 10 })]) {
    const by = Object.fromEntries(rows.map((r) => [r.reference, r]));
    assert.equal(by['1'].player, 'alice');
    assert.equal(by['2'].player, null);
    assert.equal(by.r1.player, 'alice');
    assert.equal(by.r1.provider, 'Spribe');
    assert.ok(rows.every((r) => !('userId' in r)), 'the user id stays inside the service');
  }
});
