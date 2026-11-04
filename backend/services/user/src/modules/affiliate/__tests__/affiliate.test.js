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

  /** Affiliate rewards pay in USDT (`REWARD_CURRENCY`) — BJB is retired. */
  const bonusBalance = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };
  const bjbBalance = async (uid) => {
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
    assert.equal(result.amount, '0.50000000');
    assert.equal(result.currency, 'USDT');
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

  await t.test("the admin's total wager pays, even on a row named after a VIP level", async () => {
    // Bronze I's ladder floor is 1,000; the admin saved 50, and /referral/rules prints 50.
    const admin = new AffiliateService({ models: connection.models, db: connection, logger, config: { SERVICE_NAME: 'user-service' } });
    admin.settings = { read: async () => ({ unlockTiers: [{ level: 'Bronze I', wager: '50', reward: '0.50' }] }) };
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '60' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const result = await admin.unlockFor({ memberName: member.name });
    assert.equal(result.unlocked, true);
    assert.equal(result.tier, '50');
  });

  await t.test('the same tier cannot be unlocked twice', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '6000' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const first = await service.unlockFor({ memberName: member.name });
    const second = await service.unlockFor({ memberName: member.name });

    assert.equal(first.unlocked, true);
    // 6,000 passes Bronze I (1,000) and Bronze II (3,000): both steps, once each.
    assert.equal(first.tier, '3000');
    assert.equal(first.granted.length, 2);
    assert.equal(second.unlocked, false);
    assert.equal(await connection.models.UnlockedRewards.count({ where: { uid: owner.uid } }), 2);
  });

  await t.test('reaching a HIGHER tier unlocks again', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '1500' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    await service.unlockFor({ memberName: member.name });
    await connection.models.Userwager.update({ wager: '20000' }, { where: { uid: member.uid } });

    const second = await service.unlockFor({ memberName: member.name });
    assert.equal(second.unlocked, true);
    // 1,500 → 20,000 passes Bronze II (3,000) and Bronze IV (15,000).
    assert.equal(second.tier, '15000');
    assert.equal(second.amount, '5.00000000');
    assert.deepEqual(second.granted.map((g) => g.amountUsd), ['2.50000000', '5.00000000']);
  });

  await t.test('a wager with thousands separators still finds the right tier', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '50,000' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const result = await service.unlockFor({ memberName: member.name });
    assert.equal(result.tier, '30000');
  });

  await t.test('a friend who jumps levels pays every step, and the rest stays locked (hash.game $1,000)', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '30000' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const result = await service.unlockFor({ memberName: member.name });
    // Bronze I 0.50 + Bronze II 2.50 + Bronze IV 5 + Silver I 12 = 20 of the 1,000.
    assert.deepEqual(result.granted.map((g) => g.level), ['Bronze I', 'Bronze II', 'Bronze IV', 'Silver I']);
    const locked = await service.lockedRewards({ ownerName: owner.name });
    assert.equal(locked.friends, 1);
    assert.equal(locked.perFriendUsd, '1000.00000000');
    assert.equal(locked.lockedUsd, '980.00000000');
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

  await t.test('claiming pays the wallet column stored on the reward row', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid());
    await connection.models.Credits.update({ usdt: '0' }, { where: { uid: owner.uid } });

    const reward = await connection.models.UnlockedRewards.create({
      uid: owner.uid,
      ownername: owner.name,
      membername: member.name,
      amount: '3.00',
      cointype: 'USDT',
      wager_amount: '1000',
      claimed: false,
      referalCode: owner.code,
    });

    const result = await service.claimReward({ userId: owner.uid, rewardId: reward.id });

    assert.equal(result.currency, 'USDT');
    const row = await connection.models.Credits.findOne({ where: { uid: owner.uid }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(row?.usdt ?? '0')), '3.00000000');
    assert.equal(money.toDecimalString(money.toMinor(row?.bjb ?? '0')), '0.00000000');
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
    // Legacy rows still say BJB; a retired coin cannot be credited, so they pay
    // in USDT and say so.
    assert.equal(result.currency, 'USDT');
    assert.equal(await bonusBalance(owner.uid), '8.50000000');
    assert.equal(await bjbBalance(owner.uid), '0.00000000');
  });

  await t.test('register and joining bonuses pay USDT whatever siteconfig names', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid());
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });
    // The register bonus is keyed per player; a uid reused from an older run
    // would otherwise replay instead of paying.
    await connection.models.CreditsLedger.destroy({ where: { user_id: String(member.uid) } }).catch(() => {});

    const configured = new AffiliateService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service', PUBLIC_SITE_URL: 'https://play.example.test' },
      clients: {
        admin: {
          get: async () => ({
            commissionPercent: '0', affiliateBonus: '2', registerBonus: '5', registerBonusEnabled: true,
            registerBonusCurrency: 'BJB', affiliateBonusCurrency: 'INR',
            // Sign-up booking (the deposit gate is covered in rewardsUsd.test.js).
            affiliateBonusRequiresDeposit: false,
          }),
        },
      },
    });

    const result = await configured.applyRegistrationBonuses({
      userId: member.uid, referredBy: owner.code, joined: true,
    });
    assert.equal(result.registerBonus, true);
    assert.equal(result.affiliateBonus, true);

    assert.equal(await bonusBalance(member.uid), '5.00000000');
    assert.equal(await bjbBalance(member.uid), '0.00000000');

    const joining = await connection.models.UnlockedRewards.findOne({
      where: { uid: owner.uid, membername: member.name, wager_amount: '0' }, raw: true,
    });
    assert.equal(joining.cointype, 'USDT');
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

  await t.test('join accepts the referrer username when players paste a display name', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid());
    await service.joinTeam({ userId: member.uid, referralCode: owner.name });
    const team = await connection.models.Team.findOne({ where: { membername: member.name }, raw: true });
    assert.equal(team.ownername, owner.name);
    assert.equal(team.referalCode, owner.code);
  });

  /** A player row with `refree` set and no team row — what a failed link leaves. */
  const orphan = async (refree) => {
    const uid = newUid();
    const name = `aff-${uid}`;
    await connection.models.Users.create({
      id: uid, name, password: 'x', status: 'active', referalcode: `REF${uid}`, refree,
    });
    await connection.models.Credits.create({ uid, bjb: '0' });
    return { uid, name };
  };
  const dropOrphan = async ({ uid, name }) => {
    await connection.models.Team.destroy({ where: { membername: name } });
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
  };

  await t.test('myTeam backfills a member whose refree is the owner\'s exact code', async () => {
    const owner = await seed(newUid());
    const member = await orphan(owner.code);

    const team = await service.myTeam({ userId: owner.uid });
    assert.equal(team.total, 1);
    assert.equal(team.members[0].name, member.name);

    await dropOrphan(member);
  });

  await t.test('THE BACKFILL NO LONGER CLAIMS PLAYERS BY USERNAME OR CASE-FOLDED TEXT', async () => {
    /**
     * `refree` used to be free text, matched case-insensitively against the
     * owner's NAME. A player who typed a name nobody had yet could be claimed
     * by whoever registered it and opened their team page first — and paid
     * commission on that player from then on.
     */
    const owner = await seed(newUid());
    const byName = await orphan(owner.name);
    const byUpperName = await orphan(owner.name.toUpperCase());
    const byLowerCode = await orphan(owner.code.toLowerCase());

    const team = await service.myTeam({ userId: owner.uid });
    assert.equal(team.total, 0, 'none of the free-text rows were attached');
    for (const m of [byName, byUpperName, byLowerCode]) {
      assert.equal(await connection.models.Team.count({ where: { membername: m.name } }), 0);
      await dropOrphan(m);
    }
  });

  await t.test('myTeam gives each member their id and the last 7 days of deposits in USD', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid());
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });
    const q = (sql) => connection.sequelize.query(sql, { replacements: { uid: member.uid } });
    await q(`INSERT INTO fiat_deposits (user_id, amount, currency, status, created_at, handled_at)
             VALUES (:uid, 25, 'USDT', 'approved', now(), now()), (:uid, 40, 'USDT', 'approved', now() - interval '9 days', now() - interval '9 days'),
                    (:uid, 70, 'USDT', 'pending', now(), NULL)`);
    try {
      const [row] = (await service.myTeam({ userId: owner.uid })).members;
      assert.equal(row.id, String(member.uid));
      assert.equal(row.deposits7dUsd, '25.00000000', 'only approved, only the last 7 days');
    } finally {
      await q('DELETE FROM fiat_deposits WHERE user_id = :uid');
    }
  });

  await t.test('on-wager unlocks tiers for players on a team', async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid(), { wager: '1500' });
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const result = await service.onWager({
      userId: member.uid,
      previousWager: '0',
      newWager: '1500',
    });

    assert.equal(result.onTeam, true);
    assert.equal(result.unlock.unlocked, true);
  });

  await t.test("on-wager records hash.game's commission: wager × 1% × rate × game rate", async () => {
    const owner = await seed(newUid());
    const member = await seed(newUid());
    await service.joinTeam({ userId: member.uid, referralCode: owner.code });

    const rated = new AffiliateService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service', PUBLIC_SITE_URL: 'https://play.example.test' },
      clients: {
        admin: {
          get: async (path) => {
            assert.match(path, /site-config\/affiliate/);
            return { commissionRate: '25', gameRates: { originals: '28', slots: '60', live: '60', sports: '100' }, affiliateBonus: '0', registerBonus: '0' };
          },
        },
      },
    });

    const result = await rated.onWager({
      userId: member.uid,
      previousWager: '100',
      newWager: '200',
    });

    assert.equal(result.commissionRecorded, true);
    // $100 of slots: 100 × 1% × 25% × 60% = 0.15.
    assert.equal(result.commission, '0.15000000');

    // The same $100 on an original: × 28% → 0.07; on sports: × 100% → 0.25.
    const original = await rated.onWager({ userId: member.uid, previousWager: '200', newWager: '300', kind: { category: 'originals' } });
    assert.equal(original.commission, '0.07000000');
    const sports = await rated.onWager({ userId: member.uid, previousWager: '300', newWager: '400', kind: { category: 'sports' } });
    assert.equal(sports.commission, '0.25000000');

    const rows = await connection.models.Rewards.findAll({
      where: { ownername: owner.name, membername: member.name },
      raw: true,
    });
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => String(r.referalmount) === '100.00000000'));
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
    assert.equal(unclaimed.claimedTotal, '0.00000000');
  });

  await t.test('unclaimed rewards reports claimed and outstanding totals separately', async () => {
    const owner = await seed(newUid());
    await connection.models.UnlockedRewards.create({
      uid: owner.uid,
      ownername: owner.name,
      membername: 'member',
      amount: '3.00',
      cointype: 'BJB',
      wager_amount: '1000',
      claimed: true,
      referalCode: owner.code,
    });
    await connection.models.UnlockedRewards.create({
      uid: owner.uid,
      ownername: owner.name,
      membername: 'member',
      amount: '4.00',
      cointype: 'BJB',
      wager_amount: '5000',
      claimed: false,
      referalCode: owner.code,
    });

    const summary = await service.unclaimedRewards({ userId: owner.uid });
    assert.equal(summary.claimedTotal, '3.00000000');
    assert.equal(summary.total, '4.00000000');
  });

  await t.test('reward history lists one kind, claimed and available, newest first', async () => {
    const owner = await seed(newUid());
    for (const [amount, claimed] of [['3.00', true], ['4.00', false]]) {
      await connection.models.UnlockedRewards.create({
        uid: owner.uid, ownername: owner.name, membername: 'member',
        amount, cointype: 'USDT', wager_amount: '0', claimed, referalCode: owner.code,
      });
    }

    const referral = await service.rewardHistory({ userId: owner.uid, kind: 'referral' });
    assert.equal(referral.total, 2);
    assert.deepEqual(referral.rows.map((r) => [r.amount, r.status]), [['4.00000000', 'available'], ['3.00000000', 'claimed']]);
    assert.ok(referral.rows[0].createdAt);
    assert.equal((await service.rewardHistory({ userId: owner.uid, kind: 'commission' })).total, 0);
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

test("default currency INR: the admin's referral steps are rupees, shown and paid as is", async () => {
  const { AffiliateService: Service } = require('../affiliate.service');
  const rate = '0.0105'; // 1 INR in USD
  const rewardMoney = {
    currency: async () => 'INR',
    toUsd: async (amount, from) => (from === 'INR' ? (Number(amount) * Number(rate)).toFixed(8) : String(amount)),
    convert: async (amount, from, to) => (from === to ? String(amount) : from === 'USD' && to === 'INR' ? String(Number(amount) / Number(rate)) : null),
  };
  const service = new Service({
    models: { Team: { findAll: async () => [] }, SiteFeature: { findByPk: async (key) => (key === 'default_currency' ? { variant: 'INR' } : null) } },
    db: {},
    logger: null,
    config: {},
    rewardMoney,
  });
  service.settings = { read: async () => ({ unlockTiers: [{ level: 'Bronze I', wager: '1000', reward: '0.5' }, { level: 'Gold', wager: '5000', reward: '9.5' }] }) };
  const locked = await service.lockedRewards({ ownerName: 'nobody' });
  assert.equal(locked.currency, 'INR');
  assert.equal(locked.perFriend, '10.00000000', '₹10 per friend, not $10 converted');
  assert.equal(locked.perFriendUsd, '0.10500000');
});
