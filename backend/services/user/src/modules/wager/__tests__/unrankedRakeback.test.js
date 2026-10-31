'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money, vipRewards } = require('@ibitplay/common');

const { WagerActivityService } = require('../wagerActivity.service');
const { VipService } = require('../../vip/vip.service');
const { RakebackService } = require('../../rakeback/rakeback.service');

/**
 * An Unranked stake earns no rakeback.
 *
 * `vipRewards` gives the Unranked card a rate of 0 and Wood 0.1%. `onWager` syncs
 * `users.rakeback` to 0 for a player still below Wood, and `rakeback.accrue` read that 0
 * as "rate not synced yet" and fell back to the Bronze default (0.2%) — so a player's
 * first $499 earned twice the rakeback of a Wood player's stakes. Found by the
 * wagering-ladder QA run (`scripts/qa/wagering-ladder.mjs`).
 */
const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
let nextUid = 984_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('unranked stakes accrue no rakeback', async (t) => {
  const logger = createLogger({ name: 'unranked-rakeback-test', level: 'silent' });
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
  const uid = newUid();
  const cleanup = async () => {
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
    await cleanup().catch(() => {});
    await connection.close();
  });
  await cleanup();
  await models.Users.create({ id: uid, name: `unr-${uid}`, password: 'x', status: 'active', referalcode: `UNR${uid}`, rakeback: '0', rakeamount: '0' });
  await models.Credits.create({ uid });

  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } };
  const service = new WagerActivityService({
    ...deps,
    vip: new VipService(deps),
    rakeback: new RakebackService(deps),
    affiliate: { onWager: async () => ({}) },
    playerBonuses: { onStake: async () => ({}), onReverse: async () => ({}) },
  });
  const rakeOf = async () => money.toDecimalString(money.toMinorQuantised(String((await models.Users.findByPk(uid, { raw: true })).rakeamount)));
  const rate = async () => String((await models.Users.findByPk(uid, { raw: true })).rakeback);

  await t.test('a stake that leaves the player Unranked accrues nothing', async () => {
    const out = await service.record({ userId: uid, amount: '300', currency: 'USDT', source: 'unr-test', ref: `unr-${uid}-1` });
    assert.equal(out.counted, true);
    assert.ok(money.isZero(await rate()), 'rate synced to the Unranked card (0)');
    assert.equal(await rakeOf(), '0.00000000', 'no Bronze-default accrual on an Unranked stake');
    assert.equal(await models.RakebackAccrual.count({ where: { user_id: uid } }), 0);
  });

  await t.test('the stake that reaches Bronze I accrues at the Bronze rate', async () => {
    await service.record({ userId: uid, amount: '700', currency: 'USDT', source: 'unr-test', ref: `unr-${uid}-2` });
    const bronze = vipRewards.rakebackRateForCard('bronze');
    assert.equal(await rakeOf(), money.toDecimalString(money.multiply('700', bronze)), '700 × Bronze rate');
  });

  await t.test('a reversal of the Unranked stake still works with no accrual behind it', async () => {
    const out = await service.reverse({ userId: uid, source: 'unr-test', ref: `unr-${uid}-1` });
    assert.equal(out.reversed, true);
    assert.equal(out.rakebackReversed ?? '0.00000000', '0.00000000');
  });
});
