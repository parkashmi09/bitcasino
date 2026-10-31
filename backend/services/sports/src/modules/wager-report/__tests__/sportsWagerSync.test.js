'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SportsWagerSync, SOURCE } = require('../sportsWagerSync');

/** A db whose first query answers the settled bets and the second the voided activity rows. */
const fakeDb = (settled, voided) => {
  const answers = [settled, voided];
  return { QueryTypes: { SELECT: 'SELECT' }, sequelize: { query: async () => answers.shift() ?? [] } };
};

const fakeUser = (counted = true) => {
  const calls = [];
  return {
    calls,
    post: async (path, body) => {
      calls.push({ path, body });
      if (body.ref === 'boom') throw new Error('user-service down');
      return path.endsWith('/record') ? { counted } : { reversed: true };
    },
  };
};

test('records each settled bet once, in its own currency, and reverses voided ones', async () => {
  const user = fakeUser();
  const sync = new SportsWagerSync({
    db: fakeDb([{ id: 16, user_id: '9184273284', amount: '2000.00', currency: 'INR', odds: '1.85' }], [{ user_id: '3600404865', ref: '14' }]),
    clients: { user },
  });

  assert.deepEqual(await sync.run(), { counted: 1, reversed: 1 });
  assert.deepEqual(user.calls, [
    { path: '/internal/user/wager/record', body: { userId: 9184273284, amount: '2000.00', currency: 'INR', source: SOURCE, ref: '16', category: 'sports', odds: '1.8500' } },
    { path: '/internal/user/wager/reverse', body: { userId: 3600404865, source: SOURCE, ref: '14' } },
  ]);
});

test('a failed or uncounted call does not stop the sweep', async () => {
  const user = fakeUser(false);
  const sync = new SportsWagerSync({
    db: fakeDb([{ id: 'boom', user_id: 1, amount: '1', currency: 'INR' }, { id: 2, user_id: 1, amount: '5', currency: 'USDT' }], []),
    clients: { user },
    logger: { warn() {}, info() {} },
  });

  assert.deepEqual(await sync.run(), { counted: 0, reversed: 0 });
  assert.equal(user.calls.length, 2);
});
