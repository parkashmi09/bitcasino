'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword } = require('@ibitplay/auth');

const { ExchangeService } = require('../exchange.service');
const v = require('../exchange.validators');

const TXN = 'parent transaction code';

/**
 * Fake DB: users + credits in memory. `sequelize.query` answers the three
 * statements `exposureLimit.js` sends (user read, wallet lock, update).
 */
function setup({ users, credits }) {
  const writes = [];
  const sequelize = {
    async query(sql, { replacements }) {
      if (sql.startsWith('SELECT id, name, parent_staff_id FROM users')) {
        const u = users.find((x) => String(x.id) === String(replacements.userId));
        return u ? [u] : [];
      }
      if (sql.startsWith('SELECT exposure_limit FROM credits')) {
        assert.match(sql, /FOR UPDATE/);
        const c = credits[String(replacements.userId)];
        return c ? [c] : [];
      }
      if (sql.startsWith('UPDATE credits SET exposure_limit')) {
        writes.push({ ...replacements });
        credits[String(replacements.userId)].exposure_limit = replacements.exposureLimit;
        return undefined;
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { sequelize, writes };
}

async function makeService(fakeDb) {
  const hash = await hashPassword(TXN, 4);
  let transactions = 0;
  const service = new ExchangeService({
    models: {
      Staff: { findByPk: async () => ({ id: 10, transaction_password: hash }) },
      Credits: { sequelize: fakeDb.sequelize },
    },
    db: { transaction: async (fn) => { transactions += 1; return fn({}); } },
    logger: { info() {} },
    config: {},
  });
  return { service, transactions: () => transactions };
}

const PARENT = { id: 10 };
const users = () => [
  { id: 1, name: 'client1', parent_staff_id: '10' }, // direct child of 10
  { id: 2, name: 'grandchild', parent_staff_id: '11' }, // under staff 11, which is under 10
  { id: 3, name: 'direct', parent_staff_id: null }, // direct (self-signup) user
  { id: 4, name: 'nowallet', parent_staff_id: '10' },
];
const credits = () => ({ 1: { exposure_limit: '0' }, 2: { exposure_limit: '0' }, 3: { exposure_limit: '0' } });

test('direct parent sets the limit in credits.exposure_limit and gets old/new back', async () => {
  const fake = setup({ users: users(), credits: credits() });
  const { service } = await makeService(fake);

  const res = await service.setExposureLimit({ actor: PARENT, userId: 1, exposureLimit: '5000', transactionPassword: TXN });
  assert.deepEqual(res, { userId: '1', username: 'client1', oldExposureLimit: '0.00000000', newExposureLimit: '5000.00000000' });
  assert.deepEqual(fake.writes, [{ userId: 1, exposureLimit: '5000' }]);

  // 0 = remove the limit
  const off = await service.setExposureLimit({ actor: PARENT, userId: 1, exposureLimit: '0', transactionPassword: TXN });
  assert.equal(off.oldExposureLimit, '5000.00000000');
  assert.equal(off.newExposureLimit, '0.00000000');
});

test('only the direct parent, only client users; nothing written on refusal', async () => {
  const fake = setup({ users: users(), credits: credits() });
  const { service } = await makeService(fake);
  const set = (actor, userId) => service.setExposureLimit({ actor, userId, exposureLimit: '100', transactionPassword: TXN });

  await assert.rejects(set(PARENT, 2), (e) => e.status === 403 && e.code === 'EXPOSURE_LIMIT_DIRECT_PARENT_ONLY'); // grandparent
  await assert.rejects(set({ id: 99 }, 1), (e) => e.status === 403 && e.code === 'EXPOSURE_LIMIT_DIRECT_PARENT_ONLY'); // stranger
  await assert.rejects(set(PARENT, 3), (e) => e.status === 403 && e.code === 'EXPOSURE_LIMIT_CLIENT_ONLY'); // direct user
  await assert.rejects(set(PARENT, 404), (e) => e.status === 404 && e.code === 'EXPOSURE_LIMIT_USER_NOT_FOUND');
  await assert.rejects(set(PARENT, 4), (e) => e.status === 404 && e.code === 'EXPOSURE_LIMIT_WALLET_NOT_FOUND');
  assert.deepEqual(fake.writes, []);
});

test('transaction code is checked before anything is read or written', async () => {
  const fake = setup({ users: users(), credits: credits() });
  const { service, transactions } = await makeService(fake);

  await assert.rejects(service.setExposureLimit({ actor: PARENT, userId: 1, exposureLimit: '100', transactionPassword: 'wrong' }));
  await assert.rejects(service.setExposureLimit({ actor: PARENT, userId: 1, exposureLimit: '100', transactionPassword: '' }));
  assert.equal(transactions(), 0);
  assert.deepEqual(fake.writes, []);
});

test('validator: number >= 0, at most 2 decimals, txn code required', () => {
  const ok = (body) => v.exposureLimit.body.safeParse(body).success;
  const base = { userId: 1, transactionPassword: 'x' };
  assert.equal(ok({ ...base, exposureLimit: '5000' }), true);
  assert.equal(ok({ ...base, exposureLimit: 5000 }), true);
  assert.equal(ok({ ...base, exposureLimit: '0' }), true);
  assert.equal(ok({ ...base, exposureLimit: '12.34' }), true);
  assert.equal(ok({ ...base, exposureLimit: '-1' }), false);
  assert.equal(ok({ ...base, exposureLimit: '1.234' }), false);
  assert.equal(ok({ ...base, exposureLimit: 'abc' }), false);
  assert.equal(ok({ ...base, exposureLimit: '' }), false);
  assert.equal(ok({ userId: 1, exposureLimit: '1' }), false);
  assert.equal(ok({ ...base, exposureLimit: '1', extra: 1 }), false);
});
