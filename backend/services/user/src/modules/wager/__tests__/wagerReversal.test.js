'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { WagerActivityService } = require('../wagerActivity.service');
const { RakebackService } = require('../../rakeback/rakeback.service');
const { backfill } = require('../../../../../../scripts/backfill-usd-wager');

/**
 * A refunded or rolled-back stake stops counting (`/internal/user/wager/reverse`,
 * migration 073), and the USD wager backfill (`scripts/backfill-usd-wager.js`).
 *
 * Test-database rate: 1 INR = 0.012 USD.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
let nextUid = 970_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const ref = () => `wr-${process.pid}-${Date.now()}-${(seq += 1)}`;

test('wager reversal and the USD backfill', async (t) => {
  const logger = createLogger({ name: 'wager-reversal-test', level: 'silent' });
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

  const { models, sequelize } = connection;
  const seeded = [];
  t.after(async () => {
    for (const uid of seeded) {
      await sequelize.query('DELETE FROM bets WHERE uid = :uid', { replacements: { uid } });
      await sequelize.query('DELETE FROM gis_transactions WHERE user_id = :uid', { replacements: { uid } });
      await models.WagerActivity.destroy({ where: { user_id: uid } });
      await models.RakebackAccrual.destroy({ where: { user_id: uid } });
      await models.UserwagerHistory.destroy({ where: { uid } });
      await models.Userwager.destroy({ where: { uid } });
      await models.Users.destroy({ where: { id: uid } });
    }
    await connection.close();
  });

  const base = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } };
  const inrRate = (await models.Exchangerate.findOne({ where: { currency: 'INR' }, raw: true }))?.usd_rate;
  assert.ok(inrRate, 'the test database carries an INR rate');
  const usdOf = (inr) => money.toDecimalString(money.multiply(inr, inrRate));
  const dec = (v) => money.toDecimalString(money.toMinorQuantised(String(v ?? '0').replace(/,/g, '')));

  const seed = async ({ wager = null, rakeback = '0.01' } = {}) => {
    const uid = newUid();
    seeded.push(uid);
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `wrev-${uid}`, password: 'x', status: 'active', rakeback, rakeamount: '0' });
    if (wager != null) await models.Userwager.create({ uid, wager });
    return uid;
  };
  const wagerOf = async (uid) => dec((await models.Userwager.findOne({ where: { uid }, raw: true }))?.wager);
  const rakeOf = async (uid) => dec((await models.Users.findByPk(uid, { raw: true })).rakeamount);

  /** The real pipeline — real rakeback accrual, VIP/affiliate stubbed out. */
  const service = new WagerActivityService({
    ...base,
    vip: { onWager: async () => {} },
    affiliate: { onWager: async () => {} },
    rakeback: new RakebackService(base),
  });

  // ── Reversal ─────────────────────────────────────────────────────────

  await t.test('a reversed INR stake leaves userwager and its unclaimed rakeback, once', async () => {
    const uid = await seed();
    const key = ref();
    await service.record({ userId: uid, amount: '1500', currency: 'INR', source: 'gis', ref: key });
    const usd = usdOf('1500');
    assert.equal(await wagerOf(uid), usd);
    const accrued = await rakeOf(uid);
    assert.equal(accrued, money.toDecimalString(money.multiply(usd, '0.01')), 'rakeback accrued on the USD stake');

    const out = await service.reverse({ userId: uid, source: 'gis', ref: key });
    assert.equal(out.reversed, true);
    assert.equal(out.usdAmount, usd);
    assert.equal(out.rakebackReversed, accrued);
    assert.equal(await wagerOf(uid), '0.00000000');
    assert.equal(await rakeOf(uid), '0.00000000');

    const again = await service.reverse({ userId: uid, source: 'gis', ref: key });
    assert.equal(again.duplicate, true, 'a retried reversal does nothing');
    assert.equal(await wagerOf(uid), '0.00000000');

    const row = await models.WagerActivity.findOne({ where: { source: 'gis', ref: key }, raw: true });
    assert.ok(row.reversed_at, 'the row is kept and stamped');
  });

  await t.test('a reversal before its stake leaves a tombstone — the late bet counts nothing', async () => {
    const uid = await seed();
    const key = ref();
    const early = await service.reverse({ userId: uid, source: 'seamless', ref: key });
    assert.equal(early.tombstone, true);

    const late = await service.record({ userId: uid, amount: '10', currency: 'USDT', source: 'seamless', ref: key });
    assert.equal(late.duplicate, true);
    assert.equal(await wagerOf(uid), '0.00000000');
    assert.equal(await rakeOf(uid), '0.00000000');
  });

  await t.test('only the reversed stake leaves; the total never goes below zero', async () => {
    const uid = await seed();
    const keep = ref();
    const drop = ref();
    await service.record({ userId: uid, amount: '10', currency: 'USDT', source: 'xcasino', ref: keep });
    await service.record({ userId: uid, amount: '4', currency: 'USDT', source: 'xcasino', ref: drop });
    // An operator lowered the total by hand in between.
    await models.Userwager.update({ wager: '2' }, { where: { uid } });

    await service.reverse({ userId: uid, source: 'xcasino', ref: drop });
    assert.equal(await wagerOf(uid), '0.00000000');
  });

  await t.test("another player's stake cannot be reversed", async () => {
    const owner = await seed();
    const other = await seed();
    const key = ref();
    await service.record({ userId: owner, amount: '10', currency: 'USDT', source: 'gis', ref: key });
    const out = await service.reverse({ userId: other, source: 'gis', ref: key });
    assert.equal(out.reason, 'USER_MISMATCH');
    assert.equal(await wagerOf(owner), '10.00000000');
  });

  // ── Backfill ─────────────────────────────────────────────────────────

  await t.test('backfill: a pre-071 INR total becomes the USD sum of its bets; refunds left out; idempotent', async () => {
    // ₹2,000 of legacy wager counted as if it were dollars: one ₹1,500 in-house
    // bet, one ₹500 bet that was refunded, and a 20 USDT GIS bet later rolled back.
    const uid = await seed({ wager: '2,000' });
    const gisBet = ref();
    await sequelize.query(
      `INSERT INTO bets (game, gid, uid, amount, coin, result, created)
       VALUES ('limbo', 1, :uid, 1500, 'inr', '{"x":1}', now()),
              ('limbo', 2, :uid, 500, 'inr', '"refunded"', now())`,
      { replacements: { uid } }
    );
    await sequelize.query(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, balance_after)
       VALUES (:uid, :bet, 'bet', -20, 'USDT', 0), (:uid, :rb, 'rollback', 20, 'USDT', 0)`,
      { replacements: { uid, bet: gisBet, rb: `rb:${gisBet}` } }
    );
    const quiet = () => {};

    const dry = await backfill({ sequelize, QueryTypes: db.QueryTypes, apply: false, log: quiet });
    assert.ok(dry.players.some((p) => p.uid === String(uid) && p.to === Number(usdOf('1500')).toFixed(8)));
    assert.equal(await wagerOf(uid), '2000.00000000', 'a dry run writes nothing');

    const applied = await backfill({ sequelize, QueryTypes: db.QueryTypes, apply: true, log: quiet });
    assert.ok(applied.inserted >= 1);
    assert.equal(await wagerOf(uid), usdOf('1500'), 'only the bet that stood, in USD');
    const rows = await models.WagerActivity.findAll({ where: { user_id: uid }, raw: true });
    assert.equal(rows.length, 1, 'the refunded bet and the rolled-back GIS bet were not counted');
    assert.equal(rows[0].source, 'inhouse');
    assert.equal(rows[0].currency, 'INR');

    const rerun = await backfill({ sequelize, QueryTypes: db.QueryTypes, apply: true, log: quiet });
    assert.ok(!rerun.players.some((p) => p.uid === String(uid)), 'a re-run changes nothing for this player');
    assert.equal(await models.WagerActivity.count({ where: { user_id: uid } }), 1);
  });

  await t.test('backfill: a stake counted live and refunded before /reverse existed is stamped and left out', async () => {
    const uid = await seed();
    const bet = ref();
    await service.record({ userId: uid, amount: '30', currency: 'USDT', source: 'gis', ref: bet });
    await sequelize.query(
      `INSERT INTO gis_transactions (user_id, transaction_id, action, amount, currency, balance_after)
       VALUES (:uid, :bet, 'bet', -30, 'USDT', 0), (:uid, :rf, 'refund', 30, 'USDT', 0)`,
      { replacements: { uid, bet, rf: `rf:${bet}` } }
    );

    await backfill({ sequelize, QueryTypes: db.QueryTypes, apply: true, log: () => {} });
    const row = await models.WagerActivity.findOne({ where: { source: 'gis', ref: bet }, raw: true });
    assert.ok(row.reversed_at);
    assert.equal(await wagerOf(uid), '0.00000000');
  });
});
