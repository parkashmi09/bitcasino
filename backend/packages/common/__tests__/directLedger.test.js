'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { categoryFor, directLedgerContext } = require('../src/directLedger');

test('direct ledger category from the wallet reason + ref type', () => {
  assert.equal(categoryFor('BET_STAKE', 'OG'), 'ORIGINAL_GAME');
  assert.equal(categoryFor('BET_PAYOUT', 'GIS'), 'CASINO');
  assert.equal(categoryFor('DEPOSIT', null), 'DEPOSIT');
  assert.equal(categoryFor('ADMIN_CREDIT'), 'ADMIN');
  assert.equal(categoryFor('race_reward_claim'), 'BONUS');
  assert.equal(categoryFor('SOMETHING_NEW'), 'OTHER');
});

test('direct ledger label goes to parker.ledger for the transaction only', async () => {
  const calls = [];
  const sequelize = { query: async (sql, opts) => calls.push({ sql, opts }) };
  await directLedgerContext(sequelize, null, { userId: 1, eventType: 'BET_STAKE' });
  assert.equal(calls.length, 0, 'no transaction → nothing labelled');
  const tx = {};
  await directLedgerContext(sequelize, tx, { userId: 7, eventType: 'BET_STAKE', category: 'ORIGINAL_GAME', gameType: 'mines' });
  assert.match(calls[0].sql, /set_config\('parker\.ledger', :ctx, true\)/);
  assert.equal(calls[0].opts.transaction, tx);
  assert.deepEqual(JSON.parse(calls[0].opts.replacements.ctx), {
    userId: '7', eventType: 'BET_STAKE', category: 'ORIGINAL_GAME', gameType: 'mines',
  });
});
