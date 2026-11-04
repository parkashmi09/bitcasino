'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { access } = require('../liveTv.service');

/**
 * Live TV (owner, 2026-11-01): gated by default — a player needs BOTH at least the minimum INR
 * balance AND a bet within the set hours; otherwise the message says to recharge, to play, or both.
 * The numbers are editable in Site config → Features (`live_tv`); blank = 200 and 10.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const logger = createLogger({ name: 'live-tv-test', level: 'silent' });
const UID = 7_800_000 + (process.pid % 10_000) * 10;

test('live TV access', async (t) => {
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
  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { replacements, type: connection.sequelize.QueryTypes.SELECT });
  const [saved] = await q(`SELECT variant, enabled, config FROM site_features WHERE feature = 'live_tv'`);

  const cleanup = async () => {
    await q(`DELETE FROM wager_activity WHERE user_id = :uid`, { uid: UID });
    await models.Credits.destroy({ where: { uid: UID } });
    await models.Users.destroy({ where: { id: UID } });
  };
  t.after(async () => {
    try {
      await cleanup();
      await q(`DELETE FROM site_features WHERE feature = 'live_tv'`);
      if (saved) {
        await q(`INSERT INTO site_features (feature, variant, enabled, config, secrets) VALUES ('live_tv', :variant, :enabled, CAST(:config AS JSONB), '{}'::jsonb)`, {
          ...saved,
          config: JSON.stringify(saved.config ?? {}),
        });
      }
    } finally {
      await connection.close();
    }
  });
  await cleanup();
  await models.Users.create({ id: UID, name: `tv-${UID}`, password: 'x', status: 'active' });
  await models.Credits.create({ uid: UID, inr: '0' });

  const setRule = async (variant, config = {}, enabled = true) => {
    await q(`DELETE FROM site_features WHERE feature = 'live_tv'`);
    await q(`INSERT INTO site_features (feature, variant, enabled, config, secrets) VALUES ('live_tv', :variant, :enabled, CAST(:config AS JSONB), '{}'::jsonb)`, {
      variant,
      enabled,
      config: JSON.stringify(config),
    });
  };
  const bet = (hoursAgo) =>
    q(
      `INSERT INTO wager_activity (user_id, source, ref, currency, amount, usd_amount, category, created_at)
       VALUES (:uid, 'test', :ref, 'INR', 100, 1.2, 'sports', NOW() - make_interval(hours => :h))`,
      { uid: UID, ref: `tv-${UID}-${hoursAgo}-${Math.random()}`, h: hoursAgo }
    );
  const balance = (inr) => models.Credits.update({ inr }, { where: { uid: UID } });

  await t.test('never configured: the gate with 200 / 10', async () => {
    await q(`DELETE FROM site_features WHERE feature = 'live_tv'`);
    const a = await access(connection, UID);
    assert.deepEqual([a.allowed, a.reason, a.minBalance, a.inactiveHours], [false, 'LOW_BALANCE_INACTIVE', '200', 10]);
    assert.match(a.message, /Please recharge: Live TV needs a balance of at least ₹200\./);
    assert.match(a.message, /Inactive: no bets in the last 10 hours\. Place a bet to start the live stream\./);
  });

  await t.test('balance alone is not enough: the player must also have played', async () => {
    await balance('500');
    const a = await access(connection, UID);
    assert.deepEqual([a.allowed, a.reason], [false, 'INACTIVE']);
    assert.doesNotMatch(a.message, /recharge/);
  });

  await t.test('a bet 11 hours ago is inactive; one 2 hours ago is active', async () => {
    await bet(11);
    assert.equal((await access(connection, UID)).reason, 'INACTIVE');
    await bet(2);
    const a = await access(connection, UID);
    assert.deepEqual([a.allowed, a.reason, a.message], [true, null, null]);
  });

  await t.test('active but below the minimum: told to recharge', async () => {
    await balance('199.99');
    const a = await access(connection, UID);
    assert.deepEqual([a.allowed, a.reason], [false, 'LOW_BALANCE']);
    assert.doesNotMatch(a.message, /Inactive/);
  });

  await t.test('the Site config numbers and message are used', async () => {
    await setRule('gated', { minBalance: '100', inactiveHours: '1', message: 'Live TV is for active players.' });
    const a = await access(connection, UID);
    assert.deepEqual([a.allowed, a.reason, a.minBalance, a.inactiveHours], [false, 'INACTIVE', '100', 1], 'the bet 2 hours ago is older than 1 hour');
    assert.match(a.message, /^Live TV is for active players\. Inactive: no bets in the last 1 hours\./);
  });

  await t.test('open: everyone; off (or switched off): nobody', async () => {
    await balance('0');
    await setRule('open');
    assert.equal((await access(connection, UID)).allowed, true);
    await setRule('none');
    assert.deepEqual([(await access(connection, UID)).allowed, (await access(connection, UID)).reason], [false, 'OFF']);
    await setRule('gated', {}, false);
    assert.equal((await access(connection, UID)).reason, 'OFF');
  });
});
