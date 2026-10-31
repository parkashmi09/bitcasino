'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { notifyPlayer, configureNotifier, settleNotifications, resetNotifierMemo, amountText } = require('../notifyPlayer');
const { withdrawalNotice } = require('../notices');
const { NotificationsService: PlayerInbox } = require('../notifications.service');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');
const { NotificationsService: AdminNotifications } = require('../../../../../admin/src/modules/notifications/notifications.service');

const { FiatDepositService } = require('../../fiat-deposit/fiatDeposit.service');
const { FiatWithdrawService } = require('../../fiat-withdraw/fiatWithdraw.service');
const { CryptoWithdrawService } = require('../../crypto-withdraw/cryptoWithdraw.service');
const { CryptoService } = require('../../crypto/crypto.service');
const { PspService } = require('../../psp/psp.service');
const { canonicalQuery } = require('../../psp/providers');
const { KycService } = require('../../kyc/kyc.service');
const { VipService } = require('../../vip/vip.service');
const { FirstDepositBonusService } = require('../../bonus/firstDepositBonus.service');
const { AffiliateService } = require('../../affiliate/affiliate.service');

/**
 * Player notifications: every trigger writes ONE row to `user_notifications`
 * (through admin-service's `notifyPlayer`, the table's owner), a repeat of the
 * same event writes nothing new, and a notification that cannot be sent never
 * breaks the money action that fired it.
 *
 * The internal hop is replaced by an in-process client that calls admin-
 * service's real service against the same test database, so the row, the
 * dedupe index (migration 072) and the socket push are all real.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let connection;
let nextUid = 930_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const newRef = () => `NTF-${process.pid}-${(seq += 1)}`;

test('player notifications', async (t) => {
  const logger = createLogger({ name: 'notify-test', level: 'silent' });

  await t.test('amounts read like money in the stored text', () => {
    assert.equal(amountText('500.00000000', 'inr'), '500.00 INR');
    assert.equal(amountText('0.00123400', 'BTC'), '0.001234 BTC');
    assert.equal(withdrawalNotice('x', 1, 'In Queue', { amount: '1', currency: 'INR' }), null);
  });

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
    configureNotifier(null);
    if (connection) await connection.close();
  });

  const { models } = connection;
  const admin = new AdminNotifications({ models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' }, features: null });

  /* The notifier's container: the internal client, a socket server that
     records what it pushed, and a switch to make the hop fail. */
  const emitted = [];
  let failing = false;
  const notifierDeps = {
    logger,
    io: { to: (room) => ({ emit: (event, frame) => emitted.push({ room, event, frame: JSON.parse(frame.toString()) }) }) },
    clients: {
      admin: {
        async request(method, url, { body }) {
          assert.equal(method, 'PUT');
          assert.equal(url, '/internal/admin/notifications/player');
          if (failing) throw new Error('admin-service unreachable');
          return admin.notifyPlayer({
            userId: body.userId, title: body.title, body: body.body, type: body.kind, data: body.data, dedupeKey: body.key,
          });
        },
      },
    },
  };
  configureNotifier(notifierDeps);
  t.beforeEach(() => {
    failing = false;
    resetNotifierMemo();
  });

  const rows = async (uid, kind) => {
    await settleNotifications();
    return models.UserNotifications.findAll({
      where: { user_id: uid, ...(kind ? { type: kind } : {}) },
      order: [['id', 'ASC']],
      raw: true,
    });
  };

  const seed = async (uid, credits = {}) => {
    await models.UserNotifications.destroy({ where: { user_id: uid } });
    await models.PlayerBonus?.destroy({ where: { user_id: uid } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `ntf-${uid}`, password: 'x', status: 'active', referalcode: `NTF${uid}`, rakeback: '0', rakeamount: '0' });
    await models.Credits.create({ uid, inr: '0', usdt: '0', ...credits });
    return uid;
  };

  const baseDeps = {
    models,
    db: connection,
    logger,
    config: {
      SERVICE_NAME: 'user-service',
      DEPOSIT_STORAGE_DIR: path.join(os.tmpdir(), `ibitplay-notify-${process.pid}`),
      KYC_STORAGE_DIR: path.join(os.tmpdir(), `ibitplay-notify-kyc-${process.pid}`),
      WITHDRAW_MINIMUM: '1',
      WITHDRAW_REQUIRE_KYC: false,
    },
  };
  /* No first-deposit terms: the deposit tests are about the deposit notice. */
  const noBonus = new FirstDepositBonusService({ ...baseDeps, welcomeBonusSettings: { firstDeposit: async () => ({ enabled: false }) } });
  const fiat = new FiatDepositService({ ...baseDeps, firstDepositBonus: noBonus });

  const lodge = async (uid, amount = '500') => {
    const row = await models.FiatDeposits.create({
      user_id: uid, amount, currency: 'INR', status: 'pending', transaction_id: newRef(),
    });
    return row.deposit_id;
  };

  // ══════════════════════════════════════════════════════════════════════

  await t.test('the helper: one row, one socket push, idempotent by key', async () => {
    const uid = await seed(newUid());
    emitted.length = 0;
    const n = { kind: 'deposit_approved', key: `test:${uid}`, title: 'Deposit approved', body: '{amount} added.', link: '#transactions', meta: { amount: '50', currency: 'INR' } };

    await notifyPlayer(uid, n);
    resetNotifierMemo(); // past the in-process memo, so the INDEX is what dedupes
    await notifyPlayer(uid, n);

    const got = await rows(uid);
    assert.equal(got.length, 1);
    assert.equal(got[0].body, '50.00 INR added.');
    assert.equal(got[0].additional_data.template, '{amount} added.');
    assert.equal(got[0].additional_data.link, '#transactions');
    assert.deepEqual(got[0].additional_data.meta, { amount: '50', currency: 'INR' });

    const pushes = emitted.filter((e) => e.room.endsWith(String(uid)));
    assert.equal(pushes.length, 1, 'only a NEW row is pushed');
    assert.equal(pushes[0].event, 'notificationsUnread');
    assert.equal(pushes[0].frame.unread, 1);
    assert.equal(pushes[0].frame.notification.kind, 'deposit_approved');
  });

  await t.test('the helper never rejects — no client, a failing client, bad input', async () => {
    const uid = await seed(newUid());
    failing = true;
    const out = await notifyPlayer(uid, { kind: 'x', key: 'k', title: 'T' });
    assert.equal(out[0].created, false);
    assert.deepEqual(await notifyPlayer(uid, { kind: 'x', key: 'k', title: 'T' }, {}), []);
    assert.deepEqual(await notifyPlayer(null, { kind: 'x', key: 'k', title: 'T' }), []);
    assert.deepEqual(await notifyPlayer(uid, null), []);
    assert.equal((await rows(uid)).length, 0);
  });

  // ── Fiat deposits ─────────────────────────────────────────────────────

  await t.test('fiat deposit approved → one notification with the credited amount', async () => {
    const uid = await seed(newUid());
    const id = await lodge(uid, '500');
    await fiat.approve({ depositId: id }, { id: 1 });

    const got = await rows(uid, 'deposit_approved');
    assert.equal(got.length, 1);
    assert.match(got[0].body, /500\.00 INR has been added/);
    assert.equal(got[0].dedupe_key, `fiat-deposit:approved:${id}`);
    assert.equal(got[0].additional_data.meta.currency, 'INR');

    await assert.rejects(() => fiat.approve({ depositId: id }, { id: 1 })); // a double-click
    assert.equal((await rows(uid, 'deposit_approved')).length, 1);
  });

  await t.test('fiat deposit rejected → the reason reaches the player', async () => {
    const uid = await seed(newUid());
    const id = await lodge(uid, '300');
    await fiat.reject({ depositId: id, comment: 'UTR does not match' }, { id: 1 });

    const got = await rows(uid, 'deposit_rejected');
    assert.equal(got.length, 1);
    assert.match(got[0].body, /Reason: UTR does not match/);
    assert.equal(got[0].additional_data.meta.reason, 'UTR does not match');
  });

  await t.test('a failed notification does not fail the approval', async () => {
    const uid = await seed(newUid());
    const id = await lodge(uid, '200');
    failing = true;
    const result = await fiat.approve({ depositId: id }, { id: 1 });
    assert.equal(result.creditedAmount, '200.00000000');
    assert.equal((await rows(uid)).length, 0);
  });

  // ── Crypto / PSP deposits ─────────────────────────────────────────────

  await t.test('crypto deposit credited → one notification, a webhook retry adds none', async () => {
    const APP_ID = 'notify-app';
    const APP_SECRET = 'notify-secret';
    const orderId = `ntf-cc-${process.pid}-${(seq += 1)}`;
    const crypto = new CryptoService({
      ...baseDeps,
      config: { ...baseDeps.config, CCPAYMENT_APP_ID: APP_ID, CCPAYMENT_APP_SECRET: APP_SECRET, CCPAYMENT_BASE_URL: 'https://ccpayment.test' },
      // getAppOrderInfo — the order record the webhook is confirmed against.
      http: { raw: async () => ({ code: 10000, data: { coinSymbol: 'USDT', paidList: [{ recordId: `ntf-rec-${orderId}`, amount: '100', status: 'Success', isFlaggedAsRisky: false }] } }) },
      firstDepositBonus: noBonus,
    });
    const uid = await seed(newUid());
    await models.Ccdeposit.destroy({ where: { orderid: orderId } });
    await models.Ccdeposit.create({
      userid: String(uid), coinid: 1280, price: '100', orderid: orderId, chain: 'TRC20', status: 'Processing',
      created_at: new Date(), updated_at: new Date(),
    });
    const signed = () => {
      const rawBody = JSON.stringify({ type: 'ApiDeposit', msg: { orderId, coinSymbol: 'USDT', status: 'Success', amount: '100' } });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = nodeCrypto.createHmac('sha256', APP_SECRET).update(`${APP_ID}${timestamp}${rawBody}`).digest('hex');
      return { rawBody, signature, timestamp };
    };

    assert.equal((await crypto.handleWebhook(signed())).credited, true);
    await crypto.handleWebhook(signed());

    const got = await rows(uid, 'deposit_credited');
    assert.equal(got.length, 1);
    assert.match(got[0].body, /100\.00 USDT has been credited/);
  });

  const UPI_SECRET = 'notify-upi-secret';
  const signUpi = (body) =>
    nodeCrypto.createHmac('sha256', UPI_SECRET).update(canonicalQuery(body, { exclude: ['sign', 'signature', 'hash'] })).digest('hex');

  await t.test('PSP deposit credited → one notification', async () => {
    const psp = new PspService({ ...baseDeps, config: { ...baseDeps.config, UPI_WEBHOOK_SECRET: UPI_SECRET }, firstDepositBonus: noBonus });
    const uid = await seed(newUid());
    const reference = newRef();
    await models.Upideposit.create({ uid, amount: '100', transactioniduser: reference, status: 'pending' });
    const body = { client_txn_id: reference, status: 'success', amount: '100' };

    const settled = await psp.handleCallback({ provider: 'upi', body: { ...body, sign: signUpi(body) }, ip: '203.0.113.9' });
    assert.equal(settled.settled, true);

    const got = await rows(uid, 'deposit_credited');
    assert.equal(got.length, 1);
    assert.equal(got[0].dedupe_key, `psp-deposit:credited:upi:${reference}`);
  });

  await t.test('PSP payout paid / failed → withdrawal_paid / withdrawal_rejected, once each', async () => {
    const apayKeys = { APAY_WEBHOOK_ACCESS_KEY: 'notify-access', APAY_WEBHOOK_PRIVATE_KEY: 'notify-private' };
    const apay = new PspService({ ...baseDeps, config: { ...baseDeps.config, ...apayKeys } });
    const apayBody = (transactions) => {
      const json = JSON.stringify(transactions);
      return {
        access_key: apayKeys.APAY_WEBHOOK_ACCESS_KEY,
        signature: nodeCrypto.createHash('sha1')
          .update(`${apayKeys.APAY_WEBHOOK_ACCESS_KEY}${apayKeys.APAY_WEBHOOK_PRIVATE_KEY}` + nodeCrypto.createHash('md5').update(json).digest('hex'))
          .digest('hex'),
        transactions: json,
      };
    };
    const payout = async (uid, amount) => {
      const reference = newRef();
      await models.Apaywithdrawals.create({
        order_id: reference, user_id: String(uid), amount, currency: 'INR',
        payment_system: 'imps', custom_transaction_id: reference, status: 'Pending', refunded: false,
      });
      return reference;
    };
    const uid = await seed(newUid());

    const paid = await payout(uid, '400');
    const paidBody = apayBody([{ order_id: paid, custom_transaction_id: paid, status: 'success', amount: '400' }]);
    await apay.handlePayoutCallback({ provider: 'apay', body: paidBody, ip: '203.0.113.9' });
    await apay.handlePayoutCallback({ provider: 'apay', body: paidBody, ip: '203.0.113.9' });

    const failed = await payout(uid, '250');
    await apay.handlePayoutCallback({
      provider: 'apay',
      body: apayBody([{ order_id: failed, custom_transaction_id: failed, status: 'Failed', amount: '250' }]),
      ip: '203.0.113.9',
    });

    assert.equal((await rows(uid, 'withdrawal_paid')).length, 1);
    const rejected = await rows(uid, 'withdrawal_rejected');
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].body, /250\.00 INR withdrawal could not be paid out/);
  });

  // ── Withdrawal queues ─────────────────────────────────────────────────

  await t.test('fiat withdrawal approved → paid, and a rejected one with its reason', async () => {
    const withdrawals = new FiatWithdrawService(baseDeps);
    const uid = await seed(newUid());
    const make = async (amount) => (await models.FiatWithdrawals.create({ uid, amount, currency: 'INR', status: 'In Queue', account_holder_name: 'A Player' })).id;

    const a = await make('100');
    await withdrawals.updateStatus({ withdrawalId: a, status: 'Approved' }, { id: 1 });
    await withdrawals.updateStatus({ withdrawalId: a, status: 'Paid' }, { id: 1 });
    const b = await make('50');
    const result = await withdrawals.updateStatus({ withdrawalId: b, status: 'Rejected', comment: 'Bank details wrong' }, { id: 1 });
    assert.equal(result.refunded, true);

    assert.equal((await rows(uid, 'withdrawal_approved')).length, 1);
    assert.equal((await rows(uid, 'withdrawal_paid')).length, 1);
    const rejected = await rows(uid, 'withdrawal_rejected');
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].body, /50\.00 INR withdrawal #\d+ was rejected.*Reason: Bank details wrong/);
  });

  await t.test('crypto withdrawal approved / rejected → one notification each; failure is harmless', async () => {
    const queue = new CryptoWithdrawService(baseDeps);
    const uid = await seed(newUid());
    const make = async () => (await models.Withdrawals.create({ uid, coin: 'USDT', amount: '20', status: 'In Queue', wallet: 'T-test' })).id;

    const a = await make();
    await queue.decide({ withdrawalId: a, status: 'Approved' }, { id: 1 });
    const b = await make();
    failing = true;
    const result = await queue.decide({ withdrawalId: b, status: 'Rejected', comment: 'Address flagged' }, { id: 1 });
    assert.equal(result.refunded, true, 'the refund happened even though the notification failed');
    failing = false;

    assert.equal((await rows(uid, 'withdrawal_approved')).length, 1);
    assert.equal((await rows(uid, 'withdrawal_rejected')).length, 0);
  });

  // ── KYC ───────────────────────────────────────────────────────────────

  await t.test('KYC approved / rejected → kyc_approved / kyc_rejected', async () => {
    const kyc = new KycService({
      ...baseDeps,
      clients: { admin: { get: async () => ({ ids: [1] }) } }, // the root staff sees everyone
    });
    const approved = await seed(newUid());
    await models.UserKyc.create({ user_id: String(approved), status: 'Pending' });
    await kyc.review({ userId: approved, status: 'Verified' }, { id: 1 });

    const rejected = await seed(newUid());
    await models.UserKyc.create({ user_id: String(rejected), status: 'Pending' });
    await kyc.review({ userId: rejected, status: 'Rejected', rejectionReason: 'Blurry photo' }, { id: 1 });

    assert.equal((await rows(approved, 'kyc_approved')).length, 1);
    const r = await rows(rejected, 'kyc_rejected');
    assert.equal(r.length, 1);
    assert.match(r[0].body, /Blurry photo/);
  });

  // ── Rewards ───────────────────────────────────────────────────────────

  await t.test('VIP level-up → one notification per paid award, none on replay', async () => {
    const vip = new VipService(baseDeps);
    const uid = await seed(newUid());
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } }).catch(() => {});

    // 0 → 1500 crosses wood levels into bronze: level-ups and no rank-up
    // (leaving Unranked is not a rank-up); then into silver for a rank-up.
    const first = await vip.onWager({ userId: uid, previousWager: '0', newWager: '1500' });
    const levelUps = first.granted.filter((g) => g.kind === 'level_up').length;
    assert.ok(levelUps >= 1);
    await vip.onWager({ userId: uid, previousWager: '0', newWager: '1500' }); // replay

    const got = await rows(uid, 'vip_level_up');
    assert.equal(got.length, levelUps);
    assert.match(got[0].body, /VIP reward has been added/);
    assert.equal(got[0].additional_data.link, '/vip');
  });

  await t.test('first deposit bonus paid → one notification', async () => {
    const bonus = new FirstDepositBonusService({
      ...baseDeps,
      welcomeBonusSettings: { firstDeposit: async () => ({ enabled: true, tiers: [{ minDeposit: '1', percent: '100', maxBonus: '100' }] }) },
      rewardMoney: {
        toReward: async (amount) => ({ amount, currency: 'USDT' }),
        toUsd: async (amount) => amount,
        fromUsd: async (amount) => ({ amount, currency: 'USDT' }),
        currency: async () => 'USDT',
      },
      affiliate: { onRefereeDeposit: async () => ({ booked: false }) },
    });
    const withBonus = new FiatDepositService({ ...baseDeps, firstDepositBonus: bonus });
    const uid = await seed(newUid());
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } }).catch(() => {});
    const id = await lodge(uid, '20');
    const result = await withBonus.approve({ depositId: id }, { id: 1 });
    assert.equal(result.firstDepositBonus.paid, true);

    const got = await rows(uid, 'first_deposit_bonus');
    assert.equal(got.length, 1);
    assert.equal(got[0].additional_data.meta.currency, 'USDT');
    assert.equal((await rows(uid, 'deposit_approved')).length, 1);
  });

  await t.test('affiliate tier unlocked → the referrer is told once', async () => {
    const affiliate = new AffiliateService({ ...baseDeps, config: { ...baseDeps.config, PUBLIC_SITE_URL: 'https://play.example.test' } });
    const owner = await seed(newUid());
    const member = await seed(newUid());
    const memberName = `ntf-${member}`;
    await models.Team.destroy({ where: { membername: memberName } });
    await models.UnlockedRewards.destroy({ where: { uid: owner } });
    await models.Userwager.destroy({ where: { uid: member } });
    await models.Userwager.create({ uid: member, wager: '1200' });
    await affiliate.joinTeam({ userId: member, referralCode: `NTF${owner}` });

    assert.equal((await affiliate.unlockFor({ memberName })).unlocked, true);
    await affiliate.unlockFor({ memberName }); // already unlocked: nothing new

    const got = await rows(owner, 'affiliate_reward');
    assert.equal(got.length, 1);
    assert.match(got[0].body, /ready to claim/);
    assert.equal((await rows(member)).length, 0, 'the member is not the one told');
  });
  await t.test('the panel: tabs by category, per-tab unread, no promotions for an agent-tree player', async () => {
    const direct = await seed(newUid());
    const agentUid = await seed(newUid());
    /* The internal hop, in process: the query arrives as strings, the comma
       lists split the way the internal route's validator splits them. */
    const list = (v) => (v ? String(v).split(',') : undefined);
    const inbox = new PlayerInbox({
      logger,
      clients: {
        admin: {
          async get(url, { query }) {
            const common = { userId: Number(query.userId), excludeTypes: list(query.excludeTypes) };
            if (url.endsWith('/history')) {
              return admin.history({ ...common, limit: query.limit, offset: query.offset, unreadOnly: query.unreadOnly, types: list(query.types) });
            }
            assert.ok(url.endsWith('/unread'));
            return admin.unreadCount({ ...common, byType: query.byType === 'true' });
          },
        },
      },
    });
    configureAgentPlayers({ isAgentPlayer: async (id) => Number(id) === agentUid });
    t.after(() => resetAgentPlayers());

    for (const uid of [direct, agentUid]) {
      await models.UserNotifications.bulkCreate([
        { user_id: uid, title: 'Maintenance tonight', body: 'b', type: 'general', is_read: false, created_at: new Date() },
        { user_id: uid, title: 'Old notice', body: 'b', type: 'general', is_read: true, created_at: new Date() },
        { user_id: uid, title: 'Deposit approved', body: 'b', type: 'deposit_approved', is_read: false, created_at: new Date() },
        { user_id: uid, title: 'Weekend reload', body: 'b', type: 'promotion', additional_data: { kind: 'campaign' }, is_read: false, created_at: new Date() },
        { user_id: uid, title: 'VIP level 2 reached', body: 'b', type: 'vip_level_up', is_read: true, created_at: new Date() },
      ]);
    }
    const titles = async (uid, category) =>
      (await inbox.list({ userId: uid, limit: 50, offset: 0, unreadOnly: false, category })).rows.map((r) => r.title).sort();

    assert.deepEqual(await titles(direct, 'system'), ['Maintenance tonight', 'Old notice']);
    assert.deepEqual(await titles(direct, 'transactions'), ['Deposit approved']);
    // A VIP reward is a bonus, so it sits with the offers.
    assert.deepEqual(await titles(direct, 'promotions'), ['VIP level 2 reached', 'Weekend reload']);
    assert.equal((await titles(direct, 'all')).length, 5);
    const page = await inbox.list({ userId: direct, limit: 2, offset: 0, unreadOnly: false, category: 'all' });
    assert.equal(page.rows.length, 2);
    assert.equal(page.total, 5, 'the total is the tab\'s, for paging');

    assert.deepEqual(await inbox.unreadCount({ userId: direct }), { unread: 3, byCategory: { system: 1, transactions: 1, promotions: 1 } });

    // The agent-tree player: no offers and no VIP reward rows, in any tab or count.
    assert.deepEqual(await titles(agentUid, 'promotions'), []);
    assert.deepEqual(await titles(agentUid, 'transactions'), ['Deposit approved']);
    assert.deepEqual(await titles(agentUid, 'all'), ['Deposit approved', 'Maintenance tonight', 'Old notice']);
    assert.deepEqual(await inbox.unreadCount({ userId: agentUid }), { unread: 2, byCategory: { system: 1, transactions: 1, promotions: 0 } });
  });
});
