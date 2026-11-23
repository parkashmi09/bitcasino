'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { QuestsService, grantKeyOf } = require('../quests.service');

const ENDS = '2026-10-19T18:30:00.000Z';

/**
 * The service over fakes. `paid` stands in for `player_bonuses` + the ledger: the fake grant
 * checks it, yields (as the real one does between its read and its insert), then writes it — so
 * without the service's lock two concurrent claims would both pay. The fake advisory lock
 * serialises transactions per key, like `pg_advisory_xact_lock`.
 */
function service({ me = { usdWagered: '60', bets: 25 }, rewards = { quest_daily_wager_reward: '2.5' }, blocked = false } = {}) {
  const paid = new Set();
  const credits = [];
  const locks = new Map();
  const db = {
    async transaction(fn) {
      const t = { held: [] };
      try {
        return await fn(t);
      } finally {
        for (const release of t.held) release();
      }
    },
    sequelize: {
      async query(sql, { replacements, transaction }) {
        assert.match(sql, /pg_advisory_xact_lock/);
        const prev = locks.get(replacements.grantKey) ?? Promise.resolve();
        let release;
        const mine = new Promise((r) => (release = r));
        locks.set(replacements.grantKey, prev.then(() => mine));
        await prev;
        transaction.held.push(release);
      },
    },
  };
  const svc = new QuestsService({
    db,
    models: { PlayerBonus: { findAll: async ({ where }) => where.grant_key.filter((k) => paid.has(k)).map((k) => ({ grant_key: k })) } },
    logger: null,
    race: { leaderboard: async () => ({ endsAt: ENDS, me }) },
    operatorSettings: { read: async (key, fallback) => rewards[key] ?? fallback },
    rewardMoney: { fromUsd: async (usd) => ({ currency: 'USDT', amount: usd }) },
    promotionsBlocked: async () => blocked,
    playerBonuses: {
      async grant(input, { transaction }) {
        assert.ok(transaction, 'granted inside the locked transaction');
        if (paid.has(input.grantKey)) return { paid: false, reason: 'ALREADY_PAID' };
        await new Promise((r) => setImmediate(r));
        paid.add(input.grantKey);
        credits.push(input);
        return { paid: true, amount: input.amount, currency: input.currency };
      },
    },
  });
  return { svc, credits };
}

test("daily quests read today's board", async () => {
  const board = (me) => ({ race: { leaderboard: async () => ({ endsAt: ENDS, me }) }, operatorSettings: { read: async (_k, f) => f } });

  const { dailyQuest } = await new QuestsService(board({ usdWagered: '34.80000000', bets: 20 })).forPlayer(7);
  assert.strictEqual(dailyQuest.second, 'dailyquest');
  assert.strictEqual(dailyQuest.first.endsAt, ENDS);
  const [wager, bets] = dailyQuest.first.quests;
  assert.deepStrictEqual([wager.progress, wager.completed], ['34.80000000', false]);
  assert.deepStrictEqual([bets.progress, bets.completed], ['20', true]);
  assert.deepStrictEqual([bets.rewardUsd, bets.claimed], ['0.00000000', false], 'no reward set: 0, nothing claimed');
  assert.strictEqual(wager.rewardSetting, undefined, 'the settings key is not leaked');

  // Not on the board yet (no bets today): zero progress, nothing completed.
  const empty = await new QuestsService(board(null)).forPlayer(7);
  assert.deepStrictEqual(empty.dailyQuest.first.quests.map((q) => [q.progress, q.completed]), [['0', false], ['0', false]]);
});

test('a completed quest pays its reward once, as a cash bonus keyed to the day', async () => {
  const { svc, credits } = service();
  const out = await svc.claim(7, 'dailyWager');
  assert.deepStrictEqual(out, { key: 'dailyWager', claimed: true, rewardUsd: '2.50000000', amount: '2.50000000', currency: 'USDT', endsAt: ENDS });
  assert.strictEqual(credits[0].grantKey, grantKeyOf('dailyWager', 7, ENDS));
  assert.strictEqual(credits[0].source, 'quest');
  assert.strictEqual(credits[0].wagerMultiplier, 0);

  const listed = (await svc.forPlayer(7)).dailyQuest.first.quests[0];
  assert.deepStrictEqual([listed.rewardUsd, listed.claimed], ['2.50000000', true]);

  // Double claim: refused, nothing more paid.
  await assert.rejects(svc.claim(7, 'dailyWager'), (e) => e.code === 'QUEST_ALREADY_CLAIMED');
  assert.strictEqual(credits.length, 1);
});

test('two concurrent claims pay once', async () => {
  const { svc, credits } = service();
  const results = await Promise.allSettled([svc.claim(7, 'dailyWager'), svc.claim(7, 'dailyWager'), svc.claim(7, 'dailyWager')]);
  assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'QUEST_ALREADY_CLAIMED'));
  assert.strictEqual(credits.length, 1);
});

test('refused: unfinished, unrewarded, unknown, and agent / demo players', async () => {
  await assert.rejects(service({ me: { usdWagered: '49.99', bets: 1 } }).svc.claim(7, 'dailyWager'), (e) => e.code === 'QUEST_NOT_COMPLETED');
  await assert.rejects(service().svc.claim(7, 'dailyBets'), (e) => e.code === 'QUEST_NO_REWARD');
  await assert.rejects(service().svc.claim(7, 'nope'), (e) => e.code === 'QUEST_NOT_FOUND');
  const blocked = service({ blocked: true });
  await assert.rejects(blocked.svc.claim(7, 'dailyWager'), (e) => e.code === 'QUEST_NOT_ELIGIBLE');
  assert.strictEqual(blocked.credits.length, 0);
});
