'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { BetHistoryService } = require('../betHistory.service');

/**
 * Original Games legs are unsigned (bet 100, win 50), so listed one per leg both read as wins —
 * live, Testuser02's Arrow Bow round (stake 100, paid 50) showed as two winning rows.
 * No database: each model is a stub that answers its fixed rows.
 */
const at = (s) => new Date(Date.UTC(2026, 9, 19, 0, 0, s));
const leg = (kind, round, amount, s) => ({
  id: s, transaction_id: `${round}-${kind}`, kind, user_id: 7, game_code: 'bow', currency: 'USDT',
  amount, round_id: round, session_id: 'x', created_at: at(s),
});

function build(rows) {
  return new BetHistoryService({
    models: {
      OgTransactions: { findAll: async () => rows },
      OgGames: { findAll: async () => [{ code: 'bow', name: 'Arrow Bow' }] },
      Users: { findAll: async () => [{ id: 7, name: 'Testuser02' }] },
    },
    logger: { warn() {} },
  });
}

test('an original-games round is one row: stake, win less stake, outcome', async () => {
  const { rows, total } = await build([
    leg('win', 'lost-half', '50', 4),
    leg('bet', 'lost-half', '100', 3),
    leg('win', 'won', '250', 2),
    leg('bet', 'won', '100', 1),
    leg('rollback', 'void', '100', 6),
    leg('bet', 'void', '100', 5),
  ]).list({ page: 1, limit: 10, userId: 7, source: 'og' });

  assert.equal(total, 3);
  const by = Object.fromEntries(rows.map((r) => [r.round_id, r]));
  assert.deepEqual([by['lost-half'].amount, by['lost-half'].profit, by['lost-half'].outcome], ['100', '-50', 'LOSS']);
  assert.deepEqual([by.won.amount, by.won.profit, by.won.outcome], ['100', '150', 'WIN']);
  assert.deepEqual([by.void.profit, by.void.outcome, by.void.reason], ['0', 'PUSH', 'ROLLBACK']);
  assert.equal(by.won.game_title, 'Arrow Bow');
  assert.equal(by.won.game_category, 'original');
  assert.equal(by.won.transaction_type, 'ROUND');
});
