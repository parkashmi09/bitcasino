'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { notifyBonus, afterBonus, configureNotifier, settleNotifications, resetNotifierMemo } = require('../notifyPlayer');
const { categoryOf } = require('../categories');

test('a bonus credit lands one bonus_credited row on the Promotions tab; a zero amount tells nobody', async () => {
  const sent = [];
  configureNotifier({ clients: { admin: { request: async (_m, _p, { body }) => (sent.push(body), { created: true }) } } });
  resetNotifierMemo();

  const result = { amount: '25', currency: 'INR' };
  assert.equal(afterBonus(7, (r) => ({ key: 'k1', title: 'Rakeback claimed', amount: r.amount, currency: r.currency }))(result), result);
  void notifyBonus(7, { key: 'k2', title: 'Nothing', amount: '0', currency: 'INR' });
  await settleNotifications();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'bonus_credited');
  assert.equal(sent[0].body, '25.00 INR has been added to your wallet.');
  configureNotifier(null);
});

test('bell tabs: deposits to Transactions, every bonus kind to Promotions', () => {
  for (const kind of ['deposit_credited', 'deposit_failed', 'deposit_rejected', 'deposit_approved']) assert.equal(categoryOf(kind), 'transactions', kind);
  for (const kind of ['bonus_credited', 'free_spins', 'first_deposit_bonus', 'vip_level_up', 'affiliate_reward']) assert.equal(categoryOf(kind), 'promotions', kind);
});
