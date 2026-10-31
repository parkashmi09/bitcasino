'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { GamesService } = require('../games.service');

/**
 * `recordActivity` no longer adds the raw stake to `userwager` itself — it
 * posts the stake, in its own currency, to user-service's
 * `/internal/user/wager/record`, which converts it to USD and counts it once
 * per `(source, ref)`. No database needed: the collaborators are stubbed.
 */
test('recordActivity', async (t) => {
  const build = () => {
    const posted = [];
    const increments = [];
    const service = new GamesService({
      models: { Users: { increment: async (...a) => increments.push(a) } },
      db: null,
      config: {},
      logger: { warn() {}, info() {} },
      clients: {
        user: {
          async post(path, body) {
            posted.push({ path, body });
            return { counted: true, duplicate: posted.filter((p) => p.body.ref === body.ref).length > 1 };
          },
        },
      },
    });
    service.recordPlay = async () => {};
    return { service, posted, increments };
  };

  await t.test('an INR stake is posted in INR with its bet key — never counted as dollars here', async () => {
    const { service, posted, increments } = build();
    await service.recordActivity({ userId: 7, gameRef: 'dice', wagered: '1500.00000000', currency: 'inr', source: 'inhouse', ref: '42' });

    assert.equal(posted.length, 1);
    assert.equal(posted[0].path, '/internal/user/wager/record');
    assert.deepEqual(posted[0].body, {
      userId: 7, amount: '1500.00000000', currency: 'INR', source: 'inhouse', ref: '42', rakeback: true,
      // What kind of bet (migration 132): `inhouse` is always originals.
      category: 'originals', gameRef: 'dice',
    });
    assert.equal(increments.length, 1, 'games_played once');
  });

  await t.test('a duplicate settlement does not count another game', async () => {
    const { service, increments } = build();
    await service.recordActivity({ userId: 7, wagered: '5', currency: 'USDT', source: 'gis', ref: 'x' });
    await service.recordActivity({ userId: 7, wagered: '5', currency: 'USDT', source: 'gis', ref: 'x' });
    assert.equal(increments.length, 1);
  });

  await t.test('no currency or no ref: nothing is counted', async () => {
    const { service, posted } = build();
    await service.recordActivity({ userId: 7, wagered: '5', ref: 'y' });
    await service.recordActivity({ userId: 7, wagered: '5', currency: 'USDT' });
    assert.equal(posted.length, 0);
  });

  await t.test('a launch (no stake) only records the play', async () => {
    const { service, posted, increments } = build();
    await service.recordActivity({ userId: 7, gameRef: 'dice' });
    assert.equal(posted.length, 0);
    assert.equal(increments.length, 0);
  });

  await t.test('user-service down never throws into a settlement', async () => {
    const { service } = build();
    service.clients.user.post = async () => { throw new Error('down'); };
    await assert.doesNotReject(() =>
      service.recordActivity({ userId: 7, wagered: '5', currency: 'USDT', source: 'gis', ref: 'z' })
    );
  });

  await t.test('reverseActivity posts the same (source, ref) to /wager/reverse', async () => {
    const { service, posted } = build();
    service.clients.user.post = async (path, body) => { posted.push({ path, body }); return { reversed: true }; };
    const out = await service.reverseActivity({ userId: '7', source: 'gis', ref: 'bet-1' });
    assert.deepEqual(posted, [{ path: '/internal/user/wager/reverse', body: { userId: 7, source: 'gis', ref: 'bet-1' } }]);
    assert.equal(out.reversed, true);
  });

  await t.test('reverseActivity sends a partial refund only when given one', async () => {
    const { service, posted } = build();
    service.clients.user.post = async (path, body) => { posted.push({ path, body }); return { reversed: true, partial: true }; };
    await service.reverseActivity({ userId: 7, source: 'gis', ref: 'bet-2', amount: '12.5', refundRef: 'rf-9' });
    assert.deepEqual(posted, [{
      path: '/internal/user/wager/reverse',
      body: { userId: 7, source: 'gis', ref: 'bet-2', amount: '12.50000000', refundRef: 'rf-9' },
    }]);
  });

  await t.test('reverseActivity with outbox queues a failed call for the user-service retry job', async () => {
    const { service } = build();
    const queries = [];
    service.db = { sequelize: { query: async (sql, opts) => { queries.push({ sql, opts }); return [[], 1]; } } };
    service.clients.user.post = async () => { throw new Error('down'); };
    const out = await service.reverseActivity({ userId: 7, source: 'gis', ref: 'bet-3', amount: '5', refundRef: 'rf-1', outbox: true });
    assert.deepEqual(out, { reversed: false, queued: true });
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /INSERT INTO wager_reverse_outbox/);
    assert.equal(queries[0].opts.replacements.ref, 'bet-3');
    assert.equal(queries[0].opts.replacements.amount, '5.00000000');
    assert.equal(queries[0].opts.replacements.refundRef, 'rf-1');

    // Without `outbox` nothing is queued (every casino caller passes it today).
    await service.reverseActivity({ userId: 7, source: 'xcasino', ref: 'bet-4' });
    assert.equal(queries.length, 1);
  });

  await t.test('reverseActivity never throws, and needs a key', async () => {
    const { service, posted } = build();
    service.clients.user.post = async () => { throw new Error('down'); };
    assert.deepEqual(await service.reverseActivity({ userId: 7, source: 'gis', ref: 'x' }), { reversed: false });
    assert.deepEqual(await service.reverseActivity({ userId: 7, source: 'gis' }), { reversed: false });
    assert.equal(posted.length, 0);
  });
});
