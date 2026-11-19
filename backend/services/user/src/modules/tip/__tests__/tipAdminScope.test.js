'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TipService } = require('../tip.service');

/** The staff tip list for a caller whose tree holds player 11 only. */
const listAs = async (staffId, args = {}) => {
  const queries = [];
  const row = { id: 1, from_user_id: '99', to_user_id: '11', currency: 'INR', amount: '5', note: null, created_at: new Date(0), from_name: 'outsider', to_name: 'mine' };
  const context = {
    config: { ROOT_STAFF_ID: 1 },
    clients: { admin: { get: async () => ({ ids: staffId === 1 ? [1, 7] : [7] }) } },
    models: { Users: { findAll: async () => [{ id: 11 }] } },
    db: {
      sequelize: {
        QueryTypes: { SELECT: 'SELECT' },
        query: async (sql) => {
          queries.push(sql);
          return sql.includes('GROUP BY') ? [{ currency: 'INR', count: 1, amount: '5' }] : [row];
        },
      },
    },
  };
  const result = await TipService.prototype.adminList.call(context, { staff: { id: staffId }, ...args });
  return { result, sql: queries[0] };
};

test('a scoped caller sees its own player and not who is on the other side', async () => {
  const { result } = await listAs(7);
  assert.deepEqual(result.rows[0].to, { id: 11, name: 'mine' });
  assert.deepEqual(result.rows[0].from, { id: null, name: null });
});

test('a scoped search matches names inside the tree only', async () => {
  const { sql } = await listAs(7, { search: 'out' });
  assert.match(sql, /fu\.name ILIKE :search ESCAPE '\\' AND t\.from_user_id IN \(:ids\)/);
});

test('the platform root still sees both sides', async () => {
  const { result } = await listAs(1);
  assert.deepEqual(result.rows[0].from, { id: 99, name: 'outsider' });
});
