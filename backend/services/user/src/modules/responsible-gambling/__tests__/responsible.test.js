'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ResponsibleService, windowStart } = require('../responsible.service');

const HOUR = 60 * 60 * 1000;

/**
 * The service over in-memory rows. `ledger` is what the `credits_ledger` sum returns
 * (`{ currency, reason, amount }`); every coin is worth its own amount in USD.
 */
function service({ exclusions = [], limits = [], ledger = [] } = {}) {
  const now = Date.now();
  const live = (rows, field) => rows.filter((r) => !r[field] || new Date(r[field]) > now);
  return new ResponsibleService({
    models: {
      PlayerSelfExclusion: { findAll: async () => exclusions.filter((r) => new Date(r.until_at) > now) },
      PlayerGamblingLimit: { findAll: async () => live(limits, 'expires_at') },
    },
    db: { sequelize: { QueryTypes: { SELECT: 'SELECT' }, query: async () => ledger } },
    logger: null,
    rewardMoney: { toUsd: async (amount) => amount },
  });
}

const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);

test('a casino break refuses casino stakes and lets sports stakes through', async () => {
  const svc = service({ exclusions: [{ id: 1, type: 'CASINO', created_at: ago(HOUR), until_at: ahead(HOUR) }] });
  await assert.rejects(svc.assertMayStake({ userId: 1, currency: 'USDT', amount: '1', sports: false }), (e) => e.code === 'RESPONSIBLE_SELF_EXCLUDED');
  await svc.assertMayStake({ userId: 1, currency: 'USDT', amount: '1', sports: true });
});

test('a platform break refuses every stake; an ended break refuses none', async () => {
  const on = service({ exclusions: [{ id: 1, type: 'PLATFORM', created_at: ago(HOUR), until_at: ahead(HOUR) }] });
  await assert.rejects(on.assertMayStake({ userId: 1, currency: 'USDT', amount: '1', sports: true }), (e) => e.code === 'RESPONSIBLE_SELF_EXCLUDED');
  const over = service({ exclusions: [{ id: 1, type: 'PLATFORM', created_at: ago(3 * HOUR), until_at: ago(HOUR) }] });
  await over.assertMayStake({ userId: 1, currency: 'USDT', amount: '1', sports: true });
});

test('a wager limit counts stakes less refunds and refuses the stake that would pass it', async () => {
  const limits = [{ id: 1, user_id: 1, type: 'WAGER_LIMIT', usd_amount: '100.00', period_unit: 'DAYS', created_at: ago(HOUR), expires_at: null }];
  const ledger = [
    { currency: 'USDT', reason: 'BET_STAKE', amount: '-95' },
    { currency: 'USDT', reason: 'BET_REFUND', amount: '5' },
  ];
  const svc = service({ limits, ledger });
  // 90 wagered: 10 more is exactly the limit, 10.01 is over it.
  await svc.assertMayStake({ userId: 1, currency: 'USDT', amount: '10', sports: false });
  await assert.rejects(svc.assertMayStake({ userId: 1, currency: 'USDT', amount: '10.01', sports: false }), (e) => e.code === 'RESPONSIBLE_WAGER_LIMIT_REACHED');
});

test('a loss limit counts the net outflow, so winnings make room', async () => {
  const limits = [{ id: 1, user_id: 1, type: 'LOSS_LIMIT', usd_amount: '50.00', period_unit: 'WEEKS', created_at: ago(HOUR), expires_at: null }];
  const ledger = [
    { currency: 'USDT', reason: 'BET_STAKE', amount: '-100' },
    { currency: 'USDT', reason: 'BET_PAYOUT', amount: '70' },
  ];
  const svc = service({ limits, ledger });
  // 30 lost: a 20 stake could reach 50, a 21 stake could pass it.
  await svc.assertMayStake({ userId: 1, currency: 'USDT', amount: '20', sports: false });
  await assert.rejects(svc.assertMayStake({ userId: 1, currency: 'USDT', amount: '21', sports: false }), (e) => e.code === 'RESPONSIBLE_LOSS_LIMIT_REACHED');
});

test('a limit asked to go still applies until its twelve hours are up', async () => {
  const limits = [{ id: 1, user_id: 1, type: 'WAGER_LIMIT', usd_amount: '1.00', period_unit: 'DAYS', created_at: ago(HOUR), expires_at: ahead(HOUR) }];
  await assert.rejects(service({ limits }).assertMayStake({ userId: 1, currency: 'USDT', amount: '2', sports: false }), (e) => e.code === 'RESPONSIBLE_WAGER_LIMIT_REACHED');
  const gone = [{ ...limits[0], expires_at: ago(HOUR) }];
  await service({ limits: gone }).assertMayStake({ userId: 1, currency: 'USDT', amount: '2', sports: false });
});

test('an unpriced stake is refused while a limit applies, never waved through', async () => {
  const limits = [{ id: 1, user_id: 1, type: 'WAGER_LIMIT', usd_amount: '100.00', period_unit: 'DAYS', created_at: ago(HOUR), expires_at: null }];
  const svc = service({ limits });
  svc.rewardMoney = { toUsd: async () => null };
  await assert.rejects(svc.assertMayStake({ userId: 1, currency: 'XYZ', amount: '1', sports: false }), (e) => e.code === 'RESPONSIBLE_NO_RATE');
});

test('limit windows restart on the anniversary of the limit', () => {
  const created = new Date('2026-01-10T14:00:00Z');
  assert.equal(windowStart(created, 'DAYS', new Date('2026-01-12T15:00:00Z')).toISOString(), '2026-01-12T14:00:00.000Z');
  assert.equal(windowStart(created, 'DAYS', new Date('2026-01-12T13:00:00Z')).toISOString(), '2026-01-11T14:00:00.000Z');
  assert.equal(windowStart(created, 'WEEKS', new Date('2026-01-20T00:00:00Z')).toISOString(), '2026-01-17T14:00:00.000Z');
  assert.equal(windowStart(created, 'MONTHS', new Date('2026-03-09T00:00:00Z')).toISOString(), '2026-02-10T14:00:00.000Z');
  assert.equal(windowStart(created, 'MONTHS', new Date('2026-03-10T15:00:00Z')).toISOString(), '2026-03-10T14:00:00.000Z');
});
