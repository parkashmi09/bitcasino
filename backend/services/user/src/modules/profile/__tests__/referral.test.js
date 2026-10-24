'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { ProfileService } = require('../profile.service');
const { AffiliateService } = require('../../affiliate/affiliate.service');

/**
 * `GET /user/profile/referral` and `GET /user/profile/verify-referral/:code`.
 *
 * The check on the signup form must agree with signup itself, and the
 * profile's referral link must be the one `/user/affiliate` shows.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let nextUid = 940_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('profile referral', async (t) => {
  const logger = createLogger({ name: 'profile-referral-test', level: 'silent' });

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
  const config = { SERVICE_NAME: 'user-service', PUBLIC_SITE_URL: 'https://play.example.test/' };
  const profile = new ProfileService({ models, db: connection, logger, config });
  const affiliate = new AffiliateService({ models, db: connection, logger, config });

  const created = [];
  const seed = async ({ referalcode, referral_link = null } = {}) => {
    const uid = newUid();
    const name = `prf-${uid}`;
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({
      id: uid, name, password: 'x', status: 'active',
      referalcode: referalcode === undefined ? `PRF${uid}` : referalcode,
      referral_link,
    });
    created.push(uid);
    return { uid, name, code: referalcode === undefined ? `PRF${uid}` : referalcode };
  };

  t.after(async () => {
    for (const id of created) await models.Users.destroy({ where: { id } });
    if (connection) await connection.close();
  });

  await t.test('the referral link is built like /user/affiliate, not read from referral_link', async () => {
    // `users.referral_link` is never written at registration, so reading it
    // answered null for every new account.
    const player = await seed();
    const mine = await profile.getReferral(player.uid);
    const fromAffiliate = await affiliate.referralInfo({ userId: player.uid });

    assert.equal(mine.referralCode, player.code);
    assert.equal(mine.referralLink, `https://play.example.test/referal/${player.code}`);
    assert.equal(mine.referralLink, fromAffiliate.referralLink);
  });

  await t.test('a stale referral_link column does not win over the built link', async () => {
    const player = await seed({ referral_link: 'https://old.example/ref/whatever' });
    const mine = await profile.getReferral(player.uid);
    assert.equal(mine.referralLink, `https://play.example.test/referal/${player.code}`);
  });

  await t.test('no code → both fields null', async () => {
    const player = await seed({ referalcode: null });
    assert.deepEqual(await profile.getReferral(player.uid), { referralCode: null, referralLink: null });
  });

  await t.test('verify accepts everything signup accepts: exact, other case, username', async () => {
    const owner = await seed();
    for (const typed of [owner.code, owner.code.toLowerCase(), owner.name, owner.name.toUpperCase(), ` ${owner.code} `]) {
      assert.deepEqual(await profile.verifyReferralCode(typed), { valid: true }, `typed ${JSON.stringify(typed)}`);
    }
  });

  await t.test('verify refuses what signup refuses, and says nothing more than valid', async () => {
    assert.deepEqual(await profile.verifyReferralCode(`nobody-${process.pid}-${Date.now()}`), { valid: false });

    // An account with no code of its own is not a referrer, even by name.
    const codeless = await seed({ referalcode: null });
    assert.deepEqual(await profile.verifyReferralCode(codeless.name), { valid: false });

    const owner = await seed();
    const reply = await profile.verifyReferralCode(owner.code);
    assert.deepEqual(Object.keys(reply), ['valid'], 'no owner name or id leaks to the signup form');
  });
});
