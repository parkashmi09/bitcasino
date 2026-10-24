'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, resolveVipLadder, vipRewards } = require('@ibitplay/common');

const { VipService } = require('../vip.service');
const { WagerActivityService } = require('../../wager/wagerActivity.service');
const { RakebackService } = require('../../rakeback/rakeback.service');

/**
 * `users.rakeback` follows the card of the STORED wager total, read under the
 * `userwager` row lock — not the `newWager` a side effect was handed:
 *
 *   - two stakes counted together whose VIP side effects run out of order must
 *     leave the higher card's rate, not whichever call landed last;
 *   - a reversal that drops the player a card re-syncs the rate down.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
let nextUid = 993_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const ref = () => `rrs-${process.pid}-${Date.now()}-${(seq += 1)}`;

test('VIP rakeback rate sync', async (t) => {
  const logger = createLogger({ name: 'rakeback-rate-sync-test', level: 'silent' });
  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const seeded = [];
  const cleanup = async (uid) => {
    await models.WagerActivity.destroy({ where: { user_id: uid } });
    await models.RakebackAccrual.destroy({ where: { user_id: uid } });
    await models.UserwagerHistory.destroy({ where: { uid } });
    await models.Userwager.destroy({ where: { uid } });
    await models.Userbonus.destroy({ where: { userid: uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };
  t.after(async () => {
    for (const uid of seeded) await cleanup(uid).catch(() => {});
    await connection.close();
  });

  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } };
  const vip = new VipService(deps);
  const ladder = await resolveVipLadder(models, { logger });
  const rateAt = (usd) => vipRewards.rakebackRateForCard(ladder.levelFor(usd).card);
  const rateOf = async (uid) => String((await models.Users.findByPk(uid, { attributes: ['rakeback'], raw: true })).rakeback);

  const seed = async ({ wager = null } = {}) => {
    const uid = newUid();
    await cleanup(uid);
    seeded.push(uid);
    await models.Users.create({ id: uid, name: `rrs-${uid}`, password: 'x', status: 'active', rakeback: '0', rakeamount: '0' });
    await models.Credits.create({ uid });
    if (wager != null) await models.Userwager.create({ uid, wager });
    return uid;
  };

  // The ladder this test DB carries must put these totals on different cards.
  const LOW = '600'; // wood on the default ladder
  const HIGH = '1500'; // bronze
  assert.notEqual(rateAt(LOW), rateAt(HIGH), 'LOW and HIGH sit on cards with different rates');

  await t.test('a stale lower-card call landing last does not lower the rate', async () => {
    const uid = await seed({ wager: HIGH });
    // The HIGH stake's side effect ran first…
    await vip.onWager({ userId: uid, previousWager: LOW, newWager: HIGH });
    assert.equal(await rateOf(uid), rateAt(HIGH));
    // …then the earlier, lower stake's side effect arrives with its own `newWager`.
    const late = await vip.onWager({ userId: uid, previousWager: '0', newWager: LOW });
    assert.equal(late.rate, rateAt(HIGH), 'the rate comes from the stored total');
    assert.equal(await rateOf(uid), rateAt(HIGH));
  });

  await t.test('two concurrent stakes with out-of-order side effects keep the higher card', async () => {
    const uid = await seed();
    // Hold the first stake's VIP side effect until the second stake's has finished.
    let releaseFirst;
    const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const outOfOrderVip = {
      onWager: async (args) => {
        calls += 1;
        if (calls === 1) {
          await firstHeld;
          return vip.onWager(args);
        }
        const out = await vip.onWager(args);
        releaseFirst();
        return out;
      },
      syncRakebackRate: (...a) => vip.syncRakebackRate(...a),
    };
    const service = new WagerActivityService({
      ...deps,
      vip: outOfOrderVip,
      affiliate: { onWager: async () => {} },
      rakeback: new RakebackService(deps),
      playerBonuses: { onStake: async () => ({}), onReverse: async () => ({ reversed: false }) },
    });

    // Stake 1 (LOW) commits first; its side effect is held. Stake 2 (+900) commits
    // and its side effect (HIGH) runs; then stake 1's (newWager = LOW) runs last.
    const first = service.record({ userId: uid, amount: LOW, currency: 'USDT', source: 'qa-rrs', ref: ref() });
    while (calls < 1) await new Promise((r) => setImmediate(r));
    await service.record({ userId: uid, amount: '900', currency: 'USDT', source: 'qa-rrs', ref: ref() });
    await first;

    assert.equal(await rateOf(uid), rateAt(HIGH), 'the lower card written last would be the bug');
  });

  await t.test('a reversal that drops the player a card re-syncs the rate down', async () => {
    const uid = await seed();
    const service = new WagerActivityService({
      ...deps,
      vip,
      affiliate: { onWager: async () => {} },
      rakeback: new RakebackService(deps),
      playerBonuses: { onStake: async () => ({}), onReverse: async () => ({ reversed: false }) },
    });
    const keep = ref();
    const drop = ref();
    await service.record({ userId: uid, amount: LOW, currency: 'USDT', source: 'qa-rrs', ref: keep });
    await service.record({ userId: uid, amount: '900', currency: 'USDT', source: 'qa-rrs', ref: drop });
    assert.equal(await rateOf(uid), rateAt(HIGH));

    const out = await service.reverse({ userId: uid, source: 'qa-rrs', ref: drop });
    assert.equal(out.reversed, true);
    assert.equal(out.rakebackRate, rateAt(LOW));
    assert.equal(await rateOf(uid), rateAt(LOW), 'rate follows the reduced total');

    const again = await service.reverse({ userId: uid, source: 'qa-rrs', ref: drop });
    assert.equal(again.duplicate, true);
    assert.equal(await rateOf(uid), rateAt(LOW));
  });

  await t.test('no userwager row yet: the argument is the only total there is', async () => {
    const uid = await seed();
    const out = await vip.onWager({ userId: uid, previousWager: '0', newWager: HIGH });
    assert.equal(out.rate, rateAt(HIGH));
    assert.equal(await rateOf(uid), rateAt(HIGH));
  });
});
