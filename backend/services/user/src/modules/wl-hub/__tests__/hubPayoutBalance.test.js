'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const hubOrders = require('../hubOrders');

/**
 * Audit M2: a copy's payout runs on this site's gateway account, so it is opened only when what
 * this site holds for the copy (transfers + net deposits − gross payouts, in INR) covers the
 * amount and its charge — checked under a lock on the whitelabel row. Stub DB: the held figure
 * and the rate are given; the SQL itself was checked against Postgres.
 */
function db({ held, rate = 1, unpriced = 0, wl = true }) {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (/FOR UPDATE/.test(sql)) return wl ? [{ id: 3 }] : [];
    if (/AS held/.test(sql)) return [{ held: String(held), unpriced: String(unpriced), this_to_inr: rate == null ? null : String(rate) }];
    if (/INSERT INTO whitelabel_gateway_orders/.test(sql)) return [{ id: 77 }];
    return [];
  };
  return { calls, db: { sequelize: { query }, transaction: (fn) => fn({}) } };
}
const order = { whitelabelId: 3, provider: 'x', reference: 'WD1', copyReference: 'c1', currency: 'INR', amount: '1000', chargePct: '2' };
const low = (e) => e.code === 'HUB_BALANCE_LOW';

test('covered (amount + charge): the order is opened under the whitelabel lock', async () => {
  const { db: d, calls } = db({ held: 1020 });
  assert.deepEqual(await hubOrders.openPayout(d, order), { id: 77 });
  assert.match(calls[0], /FOR UPDATE/);
  assert.match(calls.at(-1), /'payout'|:flow/);
});

test('not covered: 409 HUB_BALANCE_LOW, no order written', async () => {
  const { db: d, calls } = db({ held: 1019.99 });
  await assert.rejects(hubOrders.openPayout(d, order), low);
  assert.ok(!calls.some((s) => /INSERT/.test(s)));
});

test('a coin is counted in INR at the rate', async () => {
  await assert.rejects(hubOrders.openPayout(db({ held: 9000, rate: 90 }).db, { ...order, currency: 'USDT', amount: '100' }), low); // needs 9180
  assert.deepEqual(await hubOrders.openPayout(db({ held: 9180, rate: 90 }).db, { ...order, currency: 'USDT', amount: '100' }), { id: 77 });
});

test('fails closed: no rate for the coin, an unpriced earlier payout, or no whitelabel row', async () => {
  await assert.rejects(hubOrders.openPayout(db({ held: 1e9, rate: null }).db, order), low);
  await assert.rejects(hubOrders.openPayout(db({ held: 1e9, unpriced: 1 }).db, order), low);
  await assert.rejects(hubOrders.openPayout(db({ held: 1e9, wl: false }).db, order), low);
});
