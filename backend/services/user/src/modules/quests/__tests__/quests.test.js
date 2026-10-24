'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { QuestsService } = require('../quests.service');

test("daily quests read today's board", async () => {
  const board = (me) => ({ race: { leaderboard: async () => ({ endsAt: '2026-10-19T18:30:00.000Z', me }) } });

  const { dailyQuest } = await new QuestsService(board({ usdWagered: '34.80000000', bets: 20 })).forPlayer(7);
  assert.strictEqual(dailyQuest.second, 'dailyquest');
  assert.strictEqual(dailyQuest.first.endsAt, '2026-10-19T18:30:00.000Z');
  const [wager, bets] = dailyQuest.first.quests;
  assert.deepStrictEqual([wager.progress, wager.completed], ['34.80000000', false]);
  assert.deepStrictEqual([bets.progress, bets.completed], ['20', true]);

  // Not on the board yet (no bets today): zero progress, nothing completed.
  const empty = await new QuestsService(board(null)).forPlayer(7);
  assert.deepStrictEqual(empty.dailyQuest.first.quests.map((q) => [q.progress, q.completed]), [['0', false], ['0', false]]);
});
