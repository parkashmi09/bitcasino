'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const { WalletService } = require('../wallet.service');

/** An agent's player spends INR only (user, 2026-10-18); credits stay open for refunds. */
test('agent player: debit is INR only', async (t) => {
  configureAgentPlayers({ isAgentPlayer: async (id) => Number(id) === 42 });
  t.after(() => resetAgentPlayers());

  const moved = [];
  const db = { transaction: async () => { moved.push('tx'); return { ok: true }; } };
  const svc = new WalletService({ models: {}, db, config: {}, logger: console, clients: {} });
  const input = { amount: '10', reason: 'bet', idempotencyKey: 'k' };

  await assert.rejects(() => svc.debit({ ...input, userId: 42, currency: 'USDT' }), (e) => e.code === 'WALLET_AGENT_PLAYER_INR_ONLY');
  assert.equal(moved.length, 0);

  await svc.debit({ ...input, userId: 42, currency: 'INR' });
  await svc.debit({ ...input, userId: 7, currency: 'USDT' });
  await svc.credit({ ...input, userId: 42, currency: 'USDT' });
  assert.equal(moved.length, 3);
});
