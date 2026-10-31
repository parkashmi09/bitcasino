'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money, resolveVipLadder, vipRewards } = require('@ibitplay/common');

const { WagerActivityService } = require('../wagerActivity.service');
const { createRewardMoney } = require('../../../lib/rewardMoney');
const { VipService } = require('../../vip/vip.service');
const { AffiliateService } = require('../../affiliate/affiliate.service');
const { RakebackService } = require('../../rakeback/rakeback.service');
const { BonusService } = require('../../bonus/bonus.service');

/**
 * Rewards are counted in USD and paid in the site's ONE reward currency.
 *
 * QA (qa40) found the INR site counting rupees as dollars: ₹1,500 of play
 * paid 6.5 USDT of VIP level-ups, a referee's ₹1,000 paid 50 USDT of
 * commission, the daily bonus paid USD-sized amounts as rupees, and commission
 * could never be claimed. Each case is pinned here with the reward currency
 * set to USDT (the default) and to INR (an owner's choice).
 *
 * Test-database rate: 1 INR = 0.012 USD.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
let nextUid = 960_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const ref = () => `t-${process.pid}-${Date.now()}-${(seq += 1)}`;

test('rewards in USD, paid in the reward currency', async (t) => {
  const logger = createLogger({ name: 'rewards-usd-test', level: 'silent' });
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
  t.after(async () => connection && connection.close());

  const { models } = connection;
  const base = { models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } };

  const inrRate = (await models.Exchangerate.findOne({ where: { currency: 'INR' }, raw: true }))?.usd_rate;
  assert.ok(inrRate, 'the test database carries an INR rate');

  /** A reward-money helper with the reward currency pinned. */
  const rewardMoneyIn = (code) =>
    createRewardMoney({ ...base, rewardCurrencies: { rewardCurrency: async () => code } });

  const seed = async ({ wager = null } = {}) => {
    const uid = newUid();
    const name = `rusd-${uid}`;
    await models.Team.destroy({ where: { membername: name } });
    await models.Userbonus.destroy({ where: { userid: uid } });
    await models.Userwager.destroy({ where: { uid } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name, password: 'x', status: 'active', referalcode: `RU${uid}` });
    await models.Credits.create({ uid });
    if (wager != null) await models.Userwager.create({ uid, wager });
    return { uid, name, code: `RU${uid}` };
  };
  const balance = async (uid, code) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinorQuantised(row?.[code.toLowerCase()] ?? '0'));
  };
  const wagerOf = async (uid) => (await models.Userwager.findOne({ where: { uid }, raw: true }))?.wager;

  /** Wager pipeline with capturing stubs for the side effects. */
  const stubbed = () => {
    const calls = { vip: [], affiliate: [], rakeback: [] };
    const service = new WagerActivityService({
      ...base,
      vip: { onWager: async (a) => calls.vip.push(a) },
      affiliate: { onWager: async (a) => calls.affiliate.push(a) },
      rakeback: { accrue: async (a) => calls.rakeback.push(a) },
    });
    return { service, calls };
  };

  // ── 1. userwager / VIP XP in USD ─────────────────────────────────────

  await t.test('an INR stake is counted in USD: ₹1,500 → $18 of wager', async () => {
    const { uid } = await seed();
    const { service, calls } = stubbed();

    const out = await service.record({ userId: uid, amount: '1500', currency: 'INR', source: 'qa-sim', ref: ref() });

    const expected = money.toDecimalString(money.multiply('1500', inrRate));
    assert.equal(out.counted, true);
    assert.equal(out.usdAmount, expected);
    assert.equal(money.toDecimalString(money.toMinor(await wagerOf(uid))), expected);
    // VIP and affiliate see the same USD move; rakeback gets the USD stake.
    assert.deepEqual(calls.vip[0], { userId: uid, previousWager: '0.00000000', newWager: expected });
    assert.equal(calls.affiliate[0].newWager, expected);
    assert.equal(calls.rakeback[0].stakeUsd, expected);
  });

  await t.test('the same (source, ref) counts once — retries add nothing', async () => {
    const { uid } = await seed();
    const { service, calls } = stubbed();
    const key = ref();

    await service.record({ userId: uid, amount: '10', currency: 'USDT', source: 'gis', ref: key });
    const again = await service.record({ userId: uid, amount: '10', currency: 'USDT', source: 'gis', ref: key });

    assert.equal(again.duplicate, true);
    assert.equal(money.toDecimalString(money.toMinor(await wagerOf(uid))), '10.00000000');
    assert.equal(calls.vip.length, 1);
    assert.equal(calls.rakeback.length, 1);
  });

  await t.test('a currency with no rate counts nothing — no rate, no guess', async () => {
    const { uid } = await seed();
    const { service } = stubbed();
    const out = await service.record({ userId: uid, amount: '10', currency: 'ZZZ', source: 'gis', ref: ref() });
    assert.equal(out.counted, false);
    assert.equal(out.reason, 'NO_RATE');
    assert.equal(await wagerOf(uid), undefined);
  });

  for (const code of ['USDT', 'INR']) {
    await t.test(`₹1,500 ($18) pays nothing; ₹1,00,000 ($1,200) pays Bronze I's level-up — reward currency ${code}`, async () => {
      const { uid } = await seed();
      const rewardMoney = rewardMoneyIn(code);
      const vip = new VipService({ ...base, rewardMoney });
      const service = new WagerActivityService({
        ...base,
        vip,
        affiliate: { onWager: async () => {} },
        rakeback: { accrue: async () => {} },
      });

      await service.record({ userId: uid, amount: '1500', currency: 'INR', source: 'qa-sim', ref: ref() });
      // $18 is below the first band: the INR-counted ladder paid 6.5 USDT here.
      assert.equal(await balance(uid, code), '0.00000000');
      await service.record({ userId: uid, amount: '98500', currency: 'INR', source: 'qa-sim', ref: ref() });

      // What the ladder owes for $18 of wager, in USD.
      const ladder = await resolveVipLadder(models, { logger });
      const reached = ladder.levelFor(money.toDecimalString(money.multiply('100000', inrRate))).level;
      let owedUsd = '0.00000000';
      for (let level = 1; level <= reached; level += 1) owedUsd = money.toDecimalString(money.add(owedUsd, vipRewards.levelUpAmount(level)));
      const expected = code === 'USDT' ? owedUsd : money.toDecimalString(money.divide(owedUsd, inrRate));

      assert.equal(await balance(uid, code), expected);
      assert.ok(money.gt(owedUsd, '0'), '$1,200 crosses Bronze I');
      {
        const record = await models.Userbonus.findOne({ where: { userid: uid }, raw: true });
        assert.equal(money.toDecimalString(money.toMinorQuantised(record.vipbonus)), expected, 'vipbonus mirrored');
        assert.equal(money.toDecimalString(money.toMinorQuantised(record.totalbonus)), expected);
      }
    });
  }

  // ── reward money ─────────────────────────────────────────────────────

  await t.test('rewardMoney: USD → reward currency, and back', async () => {
    const usdt = rewardMoneyIn('USDT');
    const inr = rewardMoneyIn('INR');
    assert.deepEqual((await usdt.fromUsd('1')).currency, 'USDT');
    assert.equal((await usdt.fromUsd('1')).amount, '1.00000000');
    assert.equal((await inr.fromUsd('1')).currency, 'INR');
    assert.equal((await inr.fromUsd('1')).amount, money.toDecimalString(money.divide('1', inrRate)));
    assert.equal(await inr.toUsd('1000', 'INR'), money.toDecimalString(money.multiply('1000', inrRate)));
    assert.deepEqual(await inr.toReward('500', 'INR'), { currency: 'INR', amount: '500.00000000' });
    // An unrated reward currency pays USDT at the USD value.
    const broken = rewardMoneyIn('ZZZ');
    assert.deepEqual(await broken.fromUsd('2'), { currency: 'USDT', amount: '2.00000000', usd: '2.00000000' });
  });

  // ── 2/5. periodic bonus in the reward currency; userbonus created ────

  for (const code of ['USDT', 'INR']) {
    await t.test(`daily bonus pays the USD award in ${code} and creates the userbonus row`, async () => {
      const { uid } = await seed({ wager: '1000' }); // Bronze 1 — the daily gate
      const service = new BonusService({ ...base, rewardMoney: rewardMoneyIn(code) });
      await models.BonusClaim.destroy({ where: { userid: uid } });
      await models.BonusClaim.create({
        userid: uid,
        bonus_type: 'daily',
        bonus_amount: '0.50',
        claim_deadline: new Date(Date.now() + 3_600_000),
        created_at: new Date(),
      });

      const out = await service.claim({ userId: uid, type: 'daily' });
      const expected = code === 'USDT' ? '0.50000000' : money.toDecimalString(money.divide('0.5', inrRate));

      assert.equal(out.currency, code);
      assert.equal(out.amount, expected);
      assert.equal(out.amountUsd, '0.50000000');
      assert.equal(await balance(uid, code), expected);

      const record = await models.Userbonus.findOne({ where: { userid: uid }, raw: true });
      assert.ok(record, 'userbonus created on first claim');
      // `actual*bonus` is DECIMAL(10,2): the running total keeps cents.
      assert.ok(Math.abs(Number(record.actualdailybonus) - Number(expected)) < 0.01);
      assert.ok(Math.abs(Number(record.totalbonus) - Number(expected)) < 0.01);

      const overview = await service.overview({ userId: uid });
      assert.equal(overview.currency, code);
      const dash = await service.adminDashboard({ staff: null, userId: uid });
      assert.equal(dash.currency, code);
    });
  }

  // ── 3. affiliate commission ──────────────────────────────────────────

  const affiliateIn = (code) => {
    const service = new AffiliateService({ ...base, rewardMoney: rewardMoneyIn(code) });
    service.settings = { read: async () => ({ commissionRate: '25', gameRates: { originals: '28', slots: '60', live: '60', sports: '100' } }) };
    return service;
  };

  for (const code of ['USDT', 'INR']) {
    await t.test(`₹1,000 of referee wager pays hash.game's slots commission (0.15% of $12) in ${code}, claimable once`, async () => {
      const owner = await seed();
      const member = await seed();
      const affiliate = affiliateIn(code);
      await affiliate.joinTeam({ userId: member.uid, referralCode: owner.code });

      const pipeline = new WagerActivityService({
        ...base,
        affiliate,
        vip: { onWager: async () => {} },
        rakeback: { accrue: async () => {} },
      });
      await pipeline.record({ userId: member.uid, amount: '1000', currency: 'INR', source: 'qa-sim', ref: ref() });

      const usd = money.toDecimalString(money.percentOf(money.multiply('1000', inrRate), '0.15')); // $0.018 = ₹1.50
      const expected = code === 'USDT' ? usd : money.toDecimalString(money.divide(usd, inrRate));

      const unclaimed = await affiliate.unclaimedRewards({ userId: owner.uid });
      const row = unclaimed.rows.find((r) => r.kind === 'commission');
      assert.ok(row, 'commission is visible to the referrer');
      assert.equal(row.amount, expected);
      assert.equal(row.currency, code);
      assert.equal(unclaimed.commissionTotal, expected);

      const claimed = await affiliate.claimReward({ userId: owner.uid, rewardId: row.id, kind: 'commission' });
      assert.equal(claimed.amount, expected);
      assert.equal(await balance(owner.uid, code), expected);
      await assert.rejects(() => affiliate.claimReward({ userId: owner.uid, rewardId: row.id, kind: 'commission' }));
      assert.equal(await balance(owner.uid, code), expected, 'paid exactly once');

      const stored = await models.Rewards.findByPk(row.id, { raw: true });
      assert.equal(stored.claimed, true);
      assert.ok(stored.ledger_id, 'ledger row recorded');
      const ledger = await models.CreditsLedger.findByPk(stored.ledger_id, { raw: true });
      assert.equal(ledger.ref_type ?? ledger.refType ?? 'AFFILIATE_COMMISSION', 'AFFILIATE_COMMISSION');

      const list = await affiliate.listRewards({ owner: owner.name, kind: 'commission', limit: 10, offset: 0 });
      assert.equal(list.total, 1);
      assert.equal(list.rows[0].claimed, true);
    });
  }

  await t.test('claim-all pays tier rewards and commission; void rows never pay', async () => {
    const owner = await seed();
    const member = await seed();
    const affiliate = affiliateIn('USDT');
    await affiliate.joinTeam({ userId: member.uid, referralCode: owner.code });

    await models.Rewards.create({
      owner_id: owner.uid, ownername: owner.name, membername: member.name, referalCode: owner.code,
      amount: '2', coin: 'USDT', type: 'commission', locked: false, claimed: false, voided: false,
    });
    await models.Rewards.create({
      owner_id: owner.uid, ownername: owner.name, membername: member.name, referalCode: owner.code,
      amount: '50', coin: 'USDT', type: 'commission', locked: false, claimed: false, voided: true,
    });
    await models.UnlockedRewards.create({
      uid: owner.uid, ownername: owner.name, membername: member.name, amount: '0.5',
      cointype: 'USDT', referalCode: owner.code, wager_amount: '1000', claimed: false,
    });

    const out = await affiliate.claimAllRewards({ userId: owner.uid });
    assert.equal(out.count, 2);
    assert.equal(out.total, '2.50000000');
    assert.equal(await balance(owner.uid, 'USDT'), '2.50000000');

    const stats = await affiliate.dashboardStats();
    assert.ok(stats.commission, 'commission is part of the admin totals');
  });

  await t.test('the Rewards statement can ask for every reward reason, rakeback claims included', async () => {
    const v = require('../../wallet/wallet.validators');
    assert.deepEqual(v.listLedger.query.parse({ reason: 'REWARDS' }).reason, ['BONUS', 'rakeback_claim']);
    assert.deepEqual(v.listLedger.query.parse({ reason: 'rakeback_claim' }).reason, ['rakeback_claim']);
    assert.throws(() => v.listLedger.query.parse({ reason: 'NOPE' }));
  });

  await t.test('team joined dates come back as the stored instant (team is timestamptz since 083)', async () => {
    const { teamTimestamp } = require('../../affiliate/affiliate.service');
    // node-pg parses a timestamptz to the true instant, so it passes through unchanged.
    assert.equal(teamTimestamp(new Date('2026-10-10T10:58:25Z')), '2026-10-10T10:58:25.000Z');
    assert.equal(teamTimestamp('2026-10-10 16:28:25+05:30'), '2026-10-10T10:58:25.000Z');
    assert.equal(teamTimestamp(null), null);
  });

  // ── joining bonus waits for the referee's first deposit ───────────────

  const gated = (requiresDeposit) => {
    const service = new AffiliateService({ ...base, rewardMoney: rewardMoneyIn('USDT') });
    service.settings = {
      read: async () => ({
        affiliateBonus: '3', commissionPercent: '0', registerBonus: '0', registerBonusEnabled: false,
        affiliateBonusRequiresDeposit: requiresDeposit,
      }),
    };
    return service;
  };
  const joiningRows = (ownerId, memberName) =>
    models.UnlockedRewards.count({ where: { uid: ownerId, membername: memberName, wager_amount: '0' } });

  await t.test('joining bonus: not booked at sign-up, booked once on the first credited deposit', async () => {
    const owner = await seed();
    const member = await seed();
    const affiliate = gated(true);
    await affiliate.joinTeam({ userId: member.uid, referralCode: owner.code });

    const signup = await affiliate.applyRegistrationBonuses({ userId: member.uid, referredBy: owner.code, joined: true });
    assert.equal(signup.affiliateBonus, false);
    assert.equal(signup.affiliateBonusDeferred, true);
    assert.equal(await joiningRows(owner.uid, member.name), 0, 'a fake sign-up farms nothing');

    // Every deposit path calls FirstDepositBonusService.onDepositCredited.
    const { FirstDepositBonusService } = require('../../bonus/firstDepositBonus.service');
    const fdb = new FirstDepositBonusService({
      ...base,
      affiliate,
      rewardMoney: rewardMoneyIn('USDT'),
      welcomeBonusSettings: { firstDeposit: async () => ({ enabled: false, tiers: [] }) },
    });
    await fdb.onDepositCredited({ userId: member.uid, currency: 'INR', amount: '500', ledgerId: 1, source: 'TEST', refId: 'a' });
    await fdb.onDepositCredited({ userId: member.uid, currency: 'INR', amount: '500', ledgerId: 2, source: 'TEST', refId: 'b' });

    assert.equal(await joiningRows(owner.uid, member.name), 1, 'booked once, on the deposit');
    const row = await models.UnlockedRewards.findOne({ where: { uid: owner.uid, membername: member.name }, raw: true });
    assert.equal(money.toDecimalString(money.toMinorQuantised(row.amount)), '3.00000000');
    assert.equal(row.cointype, 'USDT');
  });

  await t.test('joining bonus with the gate switched off books at sign-up, as before', async () => {
    const owner = await seed();
    const member = await seed();
    const affiliate = gated(false);
    await affiliate.joinTeam({ userId: member.uid, referralCode: owner.code });

    const signup = await affiliate.applyRegistrationBonuses({ userId: member.uid, referredBy: owner.code, joined: true });
    assert.equal(signup.affiliateBonus, true);
    assert.equal(await joiningRows(owner.uid, member.name), 1);
    const later = await affiliate.onRefereeDeposit({ userId: member.uid });
    assert.equal(later.booked, false);
    assert.equal(await joiningRows(owner.uid, member.name), 1);
  });
});
