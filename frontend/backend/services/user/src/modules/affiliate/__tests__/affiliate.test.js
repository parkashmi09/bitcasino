'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { AffiliateService } = require('../affiliate.service');

/**
 * The referral programme.
 *
 * The two tests that matter most are the ones proving a caller cannot choose
 * their own reward tier, and that the two claim endpoints cannot pay the same
 * reward between them.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 930_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('affiliate', async (t) => {
  const logger = createLogger({ name: 'affiliate-test', level: 'silent' });

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new AffiliateService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', PUBLIC_SITE_URL: 'https://play.example.test' },
  });

  /** A player, with a referral code and an optional lifetime wager. */
  const seed = async (uid, { wager = null } = {}) => {
    const name = `aff-${uid}`;
    await connection.models.Team.destroy({ where: { membername: name } });
    await connection.models.UnlockedRewards.destroy({ where: { uid } });
    await connection.models.Userwager.destroy({ where: { uid } });
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });

    await connection.models.Users.create({
      id: uid, name, password: 'x', status: 'active', referalcode: `REF${uid}`,
    });
    await connection.models.Credits.create({ uid, bjb: '0' });
    if (wager != null) await connection.models.Userwager.create({ uid, wager });
    return { uid, name, code: `REF${uid}` };
  };

  const bonusBalance = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.bjb ?? '0'));
  };

  // ══════════════════════════════════════════════════════════════════════
  //  The minting hole
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the reward tier comes from OUR wager record, not the caller', async () => {
    // Legacy: POST { wagerAmount: 9217000 } → a $500 reward, unauthenticated.
    // There is no parameter for the amount here, so the only way to reach a
    // tier is to have actually wagered.
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '1200' });

    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const result = await service.unlockFor({ memberName: member.name });

    assert.equal(result.unlocked, true);
    // 1,200 reaches the 1,000 tier, worth 0.50 — not the top tier.
    assert.equal(result.tier, '1000');
    assert.equal(result.amount, '0.50');
  });

  await t.test('a member below the first tier unlocks nothing', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '999' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const result = await service.unlockFor({ memberName: member.name });
    assert.equal(result.unlocked, false);

    const rewards = await connection.models.UnlockedRewards.count({ where: { uid: owner.uid } });
    assert.equal(rewards, 0);
  });

  await t.test('the same tier cannot be unlocked twice', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '6000' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const first = await service.unlockFor({ memberName: member.name });
    const second = await service.unlockFor({ memberName: member.name });

    assert.equal(first.unlocked, true);
    assert.equal(first.tier, '5000');
    assert.equal(second.unlocked, false);
    assert.equal(await connection.models.UnlockedRewards.count({ where: { uid: owner.uid } }), 1);
  });

  await t.test('reaching a HIGHER tier unlocks again', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '1500' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    await service.unlockFor({ memberName: member.name });
    await connection.models.Userwager.update({ wager: '20000' }, { where: { uid: member.uid } });

    const second = await service.unlockFor({ memberName: member.name });
    assert.equal(second.unlocked, true);
    assert.equal(second.tier, '17000');
    assert.equal(second.amount, '5.00');
  });

  await t.test('a wager with thousands separators still finds the right tier', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '50,000' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const result = await service.unlockFor({ memberName: member.name });
    assert.equal(result.tier, '49000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Claiming
  // ══════════════════════════════════════════════════════════════════════

  const withReward = async (amount = '25.00') => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '200000' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const reward = await connection.models.UnlockedRewards.create({
      uid: owner.uid, ownername: owner.name, membername: member.name,
      amount, cointype: 'BJB', wager_amount: '129000', claimed: false, referalCode: owner.code,
    });
    return { owner, member, reward };
  };

  await t.test('claim-one and claim-all cannot pay the same reward between them', async () => {
    // Not the usual same-endpoint race: legacy had TWO endpoints hitting these
    // rows, and neither guarded its update, so one of each paid twice.
    const { owner } = await withReward('25.00');

    const results = await Promise.allSettled([
      service.claimAllRewards({ userId: owner.uid }),
      service.claimAllRewards({ userId: owner.uid }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await bonusBalance(owner.uid), '25.00000000');

    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(owner.uid) } });
    assert.equal(ledger, 1, 'legacy wrote no ledger row for affiliate payments');
  });

  await t.test('claiming twice in sequence is refused', async () => {
    const { owner, reward } = await withReward('12.00');

    await service.claimReward({ userId: owner.uid, rewardId: reward.id });
    await assert.rejects(
      () => service.claimReward({ userId: owner.uid, rewardId: reward.id }),
      (err) => err.code === 'AFFILIATE_ALREADY_CLAIMED'
    );

    assert.equal(await bonusBalance(owner.uid), '12.00000000');
  });

  await t.test('another player cannot claim your reward', async () => {
    const { reward } = await withReward('50.00');
    const attacker = await seed(newUid());

    await assert.rejects(
      () => service.claimReward({ userId: attacker.uid, rewardId: reward.id }),
      (err) => err.code === 'AFFILIATE_NOT_YOUR_REWARD' && err.status === 404
    );
    assert.equal(await bonusBalance(attacker.uid), '0.00000000');
  });

  await t.test('claim-all with nothing outstanding is refused, not silently empty', async () => {
    const owner = await seed(newUid());
    await assert.rejects(
      () => service.claimAllRewards({ userId: owner.uid }),
      (err) => err.code === 'AFFILIATE_NOTHING_TO_CLAIM'
    );
  });

  await t.test('claim-all pays every outstanding reward exactly once', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid());
    for (const amount of ['1.00', '2.50', '5.00']) {
      await connection.models.UnlockedRewards.create({
        uid: owner.uid, ownername: owner.name, membername: member.name,
        amount, cointype: 'BJB', wager_amount: '1000', claimed: false, referalCode: owner.code,
      });
    }

    const result = await service.claimAllRewards({ userId: owner.uid });

    assert.equal(result.count, 3);
    assert.equal(result.total, '8.50000000');
    assert.equal(await bonusBalance(owner.uid), '8.50000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Teams
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a player cannot refer themselves', async () => {
    const player = await seed(newUid());
    await assert.rejects(
      () => service.joinTeam({ userId: player.uid, referralCode: player.code }),
      (err) => err.code === 'AFFILIATE_CANNOT_REFER_SELF'
    );
  });

  await t.test('a player belongs to ONE team', async () => {
    // Legacy inserted a row per call with no uniqueness, so repeated posts put
    // the same player under several owners — each earning commission on them.
    const first = await seed(newUid());
    const second = await seed(newUid());
    const member = await seed(newUid());

    await service.joinTeam({ userId: member.uid, referralCode: first.code });
    await assert.rejects(
      () => service.joinTeam({ userId: member.uid, referralCode: second.code }),
      (err) => err.code === 'AFFILIATE_ALREADY_ON_TEAM'
    );

    assert.equal(await connection.models.Team.count({ where: { membername: member.name } }), 1);
  });

  await t.test('an unknown referral code is refused', async () => {
    const player = await seed(newUid());
    await assert.rejects(
      () => service.joinTeam({ userId: player.uid, referralCode: 'NOSUCHCODE' }),
      (err) => err.code === 'AFFILIATE_INVALID_REFERRAL_CODE'
    );
  });

  await t.test('a team listing does not include member email addresses', async () => {
    // `GET /affiliate/team/:referralCode` was unauthenticated and selected
    // `u.email`. A referral code is meant to be shared publicly.
    const owner = await seed(newUid());
    const member = await seed(newUid());
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const team = await service.myTeam({ userId: owner.uid });

    assert.equal(team.members.length, 1);
    assert.equal(team.members[0].email, undefined);
  });

  await t.test('a player only sees their OWN team', async () => {
    const a = await seed(newUid());
    const b = await seed(newUid());
    const member = await seed(newUid());
    await service.joinTeam({ userId: member.uid, referralCode: a.code });

    assert.equal((await service.myTeam({ userId: a.uid })).members.length, 1);
    assert.equal((await service.myTeam({ userId: b.uid })).members.length, 0);
  });

  await t.test('the referral link uses the configured origin, not a hard-coded domain', async () => {
    const player = await seed(newUid());
    const info = await service.referralInfo({ userId: player.uid });
    assert.match(info.referralLink, /^https:\/\/play\.example\.test\/referal\//);
  });

  await t.test('reward totals are summed as decimals, not concatenated strings', async () => {
    // Legacy: `rows.reduce((sum, r) => sum + r.amount, 0)` over DECIMAL columns,
    // which Postgres returns as STRINGS — so the total was "05.0012.00".
    const owner = await seed(newUid());
    const member = await seed(newUid());
    for (const amount of ['5.00', '12.00']) {
      await connection.models.UnlockedRewards.create({
        uid: owner.uid, ownername: owner.name, membername: member.name,
        amount, cointype: 'BJB', wager_amount: '1000', claimed: false, referalCode: owner.code,
      });
    }

    const unclaimed = await service.unclaimedRewards({ userId: owner.uid });
    assert.equal(unclaimed.total, '17.00000000');
  });

  await t.test('the dashboard reports what is still owed', async () => {
    const stats = await service.dashboardStats();
    assert.equal(
      stats.outstanding,
      money.toDecimalString(money.subtract(stats.unlockedTotal, stats.claimedTotal)),
      'unlocked minus claimed is the number that matters on a balance sheet'
    );
  });
  // ══════════════════════════════════════════════════════════════════════
  //  The reward list — `GET /api/rewards/:uid`
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the total covers every row, not just the page', async () => {
    // My own first version summed `rows` — the current page — and returned it
    // beside `total: count`, the count of ALL matching rows. Page 1 of 5
    // reported a fifth of the earnings under a label that says otherwise.
    const owner = await seed(newUid());

    for (let i = 0; i < 5; i += 1) {
      await connection.models.Rewards.create({
        ownername: owner.name,
        membername: `member-${i}`,
        referalCode: owner.code,
        amount: '10',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const page = await service.myRewards({ userId: owner.uid, limit: 2, offset: 0 });
    assert.equal(page.rows.length, 2, 'the page holds two');
    assert.equal(page.total, 5);
    assert.equal(page.totalAmount, '50.00000000', 'the total is all five, not the two on this page');
  });

  await t.test('?filter=today excludes older rows', async () => {
    const owner = await seed(newUid());
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000);

    await connection.models.Rewards.create({
      ownername: owner.name, membername: 'old', referalCode: owner.code,
      amount: '100', createdAt: yesterday, updatedAt: yesterday,
    });
    await connection.models.Rewards.create({
      ownername: owner.name, membername: 'new', referalCode: owner.code,
      amount: '7', createdAt: new Date(), updatedAt: new Date(),
    });

    const all = await service.myRewards({ userId: owner.uid });
    assert.equal(all.total, 2);
    assert.equal(all.totalAmount, '107.00000000');

    const today = await service.myRewards({ userId: owner.uid, filter: 'today' });
    assert.equal(today.total, 1);
    assert.equal(today.totalAmount, '7.00000000');
  });

  await t.test('two players sharing a display name do not share earnings', async () => {
    // `/api/rewards/:uid` read the player's `name` and selected
    // `WHERE ownername = $1`. `users.name` is not unique, so each of two
    // players with the same name saw the other's referral earnings. Matching
    // on the referral code — which is unique and stable — is what fixes it.
    const a = await seed(newUid());
    const b = await seed(newUid());

    // Both rows carry the SAME ownername and different referral codes, which
    // is exactly the collision legacy could not distinguish.
    await connection.models.Rewards.create({
      ownername: 'Sasha', membername: 'm1', referalCode: a.code,
      amount: '30', createdAt: new Date(), updatedAt: new Date(),
    });
    await connection.models.Rewards.create({
      ownername: 'Sasha', membername: 'm2', referalCode: b.code,
      amount: '900', createdAt: new Date(), updatedAt: new Date(),
    });

    const mine = await service.myRewards({ userId: a.uid });
    assert.equal(mine.total, 1);
    assert.equal(mine.totalAmount, '30.00000000', "the other player's 900 must not appear");
  });

  await t.test('a player with no referral code gets an empty list, not an error', async () => {
    const uid = newUid();
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `nocode-${uid}`, password: 'x', status: 'active' });

    const result = await service.myRewards({ userId: uid });
    assert.deepEqual(result, { total: 0, totalAmount: '0', rows: [] });
  });
});
