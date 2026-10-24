'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { OneSignalProvider, buildPayload, batchKey } = require('../../notifications/providers/onesignal');
const { NotificationsService } = require('../../notifications/notifications.service');
const { PushService } = require('../push.service');
const { render } = require('../push.templates');
const pushImage = require('../pushImage');
const errors = require('../push.errors');
const v = require('../push.validators');

/**
 * OneSignal web push: the payload builder, image checks, templates, and the
 * campaign lifecycle against a real database with a fake transport.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const APP_ID = '11111111-2222-3333-4444-555555555555';
const API_KEY = 'os_v2_app_testkeytestkeytestkey';

const STAFF_ID = 791_000 + (process.pid % 1000);
let nextUid = 781_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

/** A PNG header of the given size, padded past the 64-byte minimum. */
function png(width, height, pad = 100) {
  const b = Buffer.alloc(24 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function gif(width, height) {
  const b = Buffer.alloc(100);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function jpeg(width, height) {
  // SOI, APP0 (len 16), SOF0 (len 17: precision, h, w, …)
  const b = Buffer.alloc(120);
  let i = 0;
  b[i++] = 0xff; b[i++] = 0xd8;
  b[i++] = 0xff; b[i++] = 0xe0; b.writeUInt16BE(16, i); i += 16;
  b[i++] = 0xff; b[i++] = 0xc0; b.writeUInt16BE(17, i); b[i + 2] = 8; b.writeUInt16BE(height, i + 3); b.writeUInt16BE(width, i + 5);
  return b;
}

/** A transport that records what it was asked. */
function fakeProvider({ accept = true } = {}) {
  const calls = [];
  const ok = (n) => ({ accepted: accept ? n : 0, failures: accept ? [] : ['All included players are not subscribed'], notificationIds: accept ? ['os-notif-1'] : [] });
  return {
    calls,
    name: 'onesignal',
    async sendToUsers(ids, message) { calls.push({ kind: 'users', ids: ids.map(String), message }); return ok(ids.length); },
    async sendToAll(message) { calls.push({ kind: 'all', message }); return ok(1); },
    async sendToSegment(message, segments) { calls.push({ kind: 'segment', segments, message }); return ok(1); },
    async sendToFilters(message, filters, match) { calls.push({ kind: 'filters', filters, match, message }); return ok(1); },
  };
}

test('push notifications (OneSignal)', async (t) => {
  const logger = createLogger({ name: 'push-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  Payload — no database
  // ══════════════════════════════════════════════════════════════════════

  await t.test('text-only payload has no image fields', () => {
    const p = buildPayload(APP_ID, { title: 'Hi', body: 'There' }, { externalIds: [1, '1', 2] });
    assert.equal(p.app_id, APP_ID);
    assert.equal(p.target_channel, 'push');
    assert.deepEqual(p.headings, { en: 'Hi' });
    assert.deepEqual(p.contents, { en: 'There' });
    assert.deepEqual(p.include_aliases.external_id, ['1', '2']);
    for (const k of ['chrome_web_image', 'big_picture', 'ios_attachments', 'web_buttons', 'send_after']) assert.equal(k in p, false, k);
  });

  await t.test('image, icon, badge, buttons, priority, ttl, topic, schedule all map to OneSignal fields', () => {
    const img = 'https://cdn.example.com/p.png';
    const p = buildPayload(
      APP_ID,
      {
        title: 'Weekend boost',
        body: '50% reload',
        url: 'https://play.example.com/promotions',
        imageUrl: img,
        iconUrl: 'https://cdn.example.com/i.png',
        badgeUrl: 'https://cdn.example.com/b.png',
        buttons: [
          { id: 'claim', text: 'Claim', url: 'https://play.example.com/bonus' },
          { id: 'later', text: 'Later' },
          { id: 'third', text: 'Dropped' },
        ],
        data: { campaignId: '9' },
        priority: 'high',
        ttlSeconds: 3600,
        topic: 'weekend',
        sendAfter: '2030-01-01T10:00:00Z',
      },
      { segments: ['Total Subscriptions'] }
    );
    assert.equal(p.chrome_web_image, img);
    assert.equal(p.big_picture, img);
    assert.deepEqual(p.ios_attachments, { image: img });
    assert.equal(p.chrome_web_icon, 'https://cdn.example.com/i.png');
    assert.equal(p.firefox_icon, 'https://cdn.example.com/i.png');
    assert.equal(p.chrome_web_badge, 'https://cdn.example.com/b.png');
    assert.equal(p.web_buttons.length, 2, 'Chrome shows two buttons at most');
    assert.deepEqual(p.web_buttons[0], { id: 'claim', text: 'Claim', url: 'https://play.example.com/bonus' });
    assert.equal(p.web_buttons[1].url, 'https://play.example.com/promotions', 'a button without a URL falls back to the notification URL');
    assert.equal(p.priority, 10);
    assert.equal(p.ttl, 3600);
    assert.equal(p.web_push_topic, 'weekend');
    assert.equal(p.collapse_id, 'weekend');
    assert.equal(p.send_after, '2030-01-01T10:00:00.000Z');
    assert.deepEqual(p.included_segments, ['Total Subscriptions']);
    assert.equal(p.data.campaignId, '9');
  });

  await t.test('tag filters: AND by default, OR between filters when match=any, exists has no value', () => {
    const and = buildPayload(APP_ID, { title: 'x' }, { filters: [{ tag: 'vip_level', relation: '>', value: '3' }, { tag: 'country', relation: '=', value: 'IN' }] });
    assert.deepEqual(and.filters, [
      { field: 'tag', key: 'vip_level', relation: '>', value: '3' },
      { field: 'tag', key: 'country', relation: '=', value: 'IN' },
    ]);
    const or = buildPayload(APP_ID, { title: 'x' }, { filters: [{ tag: 'language', relation: '=', value: 'hi' }, { tag: 'currency', relation: 'exists' }], match: 'any' });
    assert.deepEqual(or.filters, [
      { field: 'tag', key: 'language', relation: '=', value: 'hi' },
      { operator: 'OR' },
      { field: 'tag', key: 'currency', relation: 'exists' },
    ]);
    assert.throws(() => buildPayload(APP_ID, { title: 'x' }, { filters: [{ tag: 'a', relation: 'LIKE', value: '1' }] }));
  });

  await t.test('the provider sends segment / filter / all / cancel with the right auth', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ id: 'n-1', recipients: 12, success: true }) };
    };
    const p = new OneSignalProvider({ appId: APP_ID, apiKey: API_KEY, fetchImpl, allSegment: 'Subscribed Users' });
    const all = await p.sendToAll({ title: 'a' });
    assert.deepEqual(calls[0].body.included_segments, ['Subscribed Users']);
    assert.equal(all.accepted, 12, 'OneSignal recipient count when it reports one');
    await p.sendToFilters({ title: 'b' }, [{ tag: 'vip_level', relation: '=', value: '5' }]);
    assert.equal(calls[1].body.filters[0].key, 'vip_level');
    assert.equal(calls[1].init.headers.authorization, `Key ${API_KEY}`);
    const c = await p.cancel('n-1');
    assert.equal(c.cancelled, true);
    assert.equal(calls[2].init.method, 'DELETE');
    assert.match(calls[2].url, /\/notifications\/n-1\?app_id=11111111/);
  });

  await t.test('batched by-id sends get distinct UUID-shaped idempotency keys', async () => {
    const bodies = [];
    const fetchImpl = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'n' }) };
    };
    const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
    const out = await new OneSignalProvider({ appId: APP_ID, apiKey: API_KEY, fetchImpl }).sendToUsers(ids, { title: 'x', idempotencyKey: 'push-campaign-7' });
    assert.equal(out.accepted, 2500, 'accepted counts players in accepted batches — not "delivered"');
    assert.equal(bodies.length, 2);
    assert.notEqual(bodies[0].idempotency_key, bodies[1].idempotency_key);
    assert.match(bodies[0].idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(batchKey('k', 0), batchKey('k', 0), 'deterministic, so a retry is de-duplicated');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Images, URLs, templates, validators — no database
  // ══════════════════════════════════════════════════════════════════════

  await t.test('image upload: format by bytes, dimensions, 1 MB cap, SVG refused', () => {
    const p = pushImage.inspectUpload({ buffer: png(1440, 720) }, errors);
    assert.equal(p.contentType, 'image/png');
    assert.deepEqual([p.width, p.height], [1440, 720]);
    assert.equal(pushImage.sizeHints(p).length, 0, '1440x720 needs no hint');

    const g = pushImage.inspectUpload({ buffer: gif(400, 400) }, errors);
    assert.equal(g.contentType, 'image/gif');
    assert.equal(pushImage.sizeHints(g).length, 2, 'not 2:1 and too narrow');

    const j = pushImage.inspectUpload({ buffer: jpeg(1024, 512) }, errors);
    assert.deepEqual([j.contentType, j.width, j.height], ['image/jpeg', 1024, 512]);

    assert.throws(() => pushImage.inspectUpload({ buffer: Buffer.alloc(1024 * 1024 + 1, 1) }, errors), (e) => e.code === 'PUSH_TOO_LARGE');
    assert.throws(() => pushImage.inspectUpload({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + ' '.repeat(80) + '</svg>'), originalname: 'x.svg' }, errors), (e) => e.code === 'PUSH_FORMAT_REFUSED');
    assert.throws(() => pushImage.inspectUpload({ buffer: Buffer.alloc(200, 0x41), mimetype: 'image/png' }, errors), (e) => e.code === 'PUSH_NOT_AN_IMAGE');
    assert.throws(() => pushImage.inspectUpload(null, errors), (e) => e.code === 'PUSH_NO_FILE');
  });

  await t.test('image URL: https required, localhost allowed with a warning, svg refused', () => {
    assert.deepEqual(pushImage.checkMediaUrl('https://cdn.example.com/a.png', errors).warnings, []);
    assert.equal(pushImage.checkMediaUrl('http://localhost:3070/api/v1/admin/push/images/1-abcdefabcdef.png', errors).warnings.length, 1);
    assert.throws(() => pushImage.checkMediaUrl('http://cdn.example.com/a.png', errors), (e) => e.code === 'PUSH_BAD_URL');
    assert.throws(() => pushImage.checkMediaUrl('https://cdn.example.com/a.svg', errors), (e) => e.code === 'PUSH_BAD_URL');
    assert.throws(() => pushImage.checkMediaUrl('/relative.png', errors), (e) => e.code === 'PUSH_BAD_URL');
  });

  await t.test('click URLs: site paths join the public origin', () => {
    assert.equal(pushImage.absoluteUrl('/vip', 'https://play.example.com/'), 'https://play.example.com/vip');
    assert.equal(pushImage.absoluteUrl('#transactions', 'https://play.example.com'), 'https://play.example.com/#transactions');
    assert.equal(pushImage.absoluteUrl('https://x.test/a', null), 'https://x.test/a');
    assert.equal(pushImage.absoluteUrl('/vip', null), null);
  });

  await t.test('template rendering fills placeholders and tidies missing ones', () => {
    assert.equal(render('{amount} has been added (deposit #{depositId}).', { amount: '500', currency: 'inr', depositId: 12 }), '500.00 INR has been added (deposit #12).');
    assert.equal(render('VIP level {level} reached', { level: 4 }), 'VIP level 4 reached');
    assert.equal(render('Rejected. Reason: {reason}.', {}), 'Rejected. Reason:.');
    assert.equal(render('{amount} bonus', { amount: '0.00012345', currency: 'btc' }), '0.00012345 BTC bonus');
  });

  await t.test('campaign validator: ≤2 buttons, audience shapes, strict', () => {
    const base = { title: 'T', body: 'B', audience: { kind: 'all' } };
    assert.equal(v.campaignBody.safeParse(base).success, true);
    assert.equal(v.campaignBody.safeParse({ ...base, buttons: [1, 2, 3].map((i) => ({ id: `b${i}`, text: 'x' })) }).success, false);
    assert.equal(v.campaignBody.safeParse({ ...base, audience: { kind: 'players', userIds: [] } }).success, false);
    assert.equal(v.campaignBody.safeParse({ ...base, audience: { kind: 'filters', filters: [{ tag: 'vip_level', relation: '>', value: '2' }] } }).success, true);
    assert.equal(v.campaignBody.safeParse({ ...base, url: 'javascript:alert(1)' }).success, false);
    assert.equal(v.campaignBody.safeParse({ ...base, url: '/promotions' }).success, true);
    assert.equal(v.campaignBody.safeParse({ ...base, extra: 1 }).success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Against a real database
  // ══════════════════════════════════════════════════════════════════════

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
      service: 'admin-service',
    });
    await connection.ping();
    await connection.sequelize.query('SELECT 1 FROM push_campaigns LIMIT 1');
  } catch (error) {
    t.skip(`No migrated test database reachable (${error.message})`);
    return;
  }
  const sql = connection.sequelize;
  const roleId = 9700 + (process.pid % 100);
  const staff = { id: STAFF_ID };
  const config = { SERVICE_NAME: 'admin-service', PUBLIC_SITE_URL: 'https://play.example.test' };

  await sql.query(`INSERT INTO roles (id, name, level) VALUES (:roleId, :name, 3) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level`, {
    replacements: { roleId, name: `push-role-${roleId}` },
  });
  await sql.query(
    `INSERT INTO staff (id, name, email, password, role_id) VALUES (:id, :name, :email, 'x', :roleId) ON CONFLICT (id) DO UPDATE SET role_id = EXCLUDED.role_id, parent_id = NULL`,
    { replacements: { id: STAFF_ID, name: `push-staff-${STAFF_ID}`, email: `push-${STAFF_ID}@test.invalid`, roleId } }
  );
  await connection.models.StaffHierarchy.findOrCreate({
    where: { ancestor_id: STAFF_ID, descendant_id: STAFF_ID },
    defaults: { ancestor_id: STAFF_ID, descendant_id: STAFF_ID, depth: 0 },
  });

  const seedPlayer = async (uid, staffId = STAFF_ID) => {
    await connection.models.UserNotifications.destroy({ where: { user_id: uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `push-${uid}`, password: 'x', status: 'active', parent_staff_id: staffId });
    return uid;
  };

  const build = (provider) => new PushService({ models: connection.models, logger, config, features: null, provider });
  const clearTables = async () => {
    await sql.query(`DELETE FROM push_campaigns WHERE created_by = :id`, { replacements: { id: STAFF_ID } });
    await sql.query('DELETE FROM push_templates');
    await sql.query(`DELETE FROM push_settings`);
  };
  await clearTables();
  t.after(async () => {
    await clearTables();
    await connection.close();
  });

  const content = { title: 'Weekend boost', body: '50% reload until Sunday', url: '/promotions', buttons: [], priority: 'normal', inbox: true };

  await t.test('lifecycle: draft → send writes inbox rows (with image) and pushes by external_id', async () => {
    const a = await seedPlayer(newUid());
    const b = await seedPlayer(newUid());
    const provider = fakeProvider();
    const svc = build(provider);

    const draft = await svc.createCampaign({ staff, ...content, imageUrl: 'https://cdn.example.com/w.png', audience: { kind: 'players', userIds: [a, b] } });
    assert.equal(draft.status, 'draft');

    const sent = await svc.sendCampaign({ staff, id: draft.id });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.recipients, 2);
    assert.equal(sent.accepted, 2);
    assert.equal(sent.inboxRows, 2);
    assert.deepEqual(sent.onesignalIds, ['os-notif-1']);

    assert.equal(provider.calls.length, 1);
    const call = provider.calls[0];
    assert.equal(call.kind, 'users');
    assert.deepEqual(call.ids.sort(), [String(a), String(b)].sort());
    assert.equal(call.message.url, 'https://play.example.test/promotions', 'site path joined to the public origin');
    assert.equal(call.message.imageUrl, 'https://cdn.example.com/w.png');
    assert.equal(call.message.idempotencyKey, `push-campaign-${draft.id}`);

    const rows = await connection.models.UserNotifications.findAll({ where: { user_id: a }, raw: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'promotion');
    assert.equal(rows[0].additional_data.image, 'https://cdn.example.com/w.png');
    assert.equal(rows[0].additional_data.link, '/promotions');

    await assert.rejects(svc.sendCampaign({ staff, id: draft.id }), (e) => e.code === 'PUSH_BAD_STATE', 'a sent campaign cannot be re-sent');
  });

  await t.test('players outside the caller’s tree are dropped; none left = AUDIENCE_EMPTY', async () => {
    const mine = await seedPlayer(newUid());
    const theirs = await seedPlayer(newUid(), null);
    const svc = build(fakeProvider());
    const preview = await svc.preview({ staff, ...content, audience: { kind: 'players', userIds: [mine, theirs] } });
    assert.equal(preview.audience.players, 1);
    assert.equal(preview.audience.skipped, 1);
    assert.equal(preview.payload.app_id, '<app id not set>');
    assert.ok(preview.warnings.some((w) => /inbox rows only|not switched on/.test(w)));

    const c = await svc.createCampaign({ staff, ...content, audience: { kind: 'players', userIds: [theirs] } });
    await assert.rejects(svc.sendCampaign({ staff, id: c.id }), (e) => e.code === 'PUSH_AUDIENCE_EMPTY');
    assert.equal((await svc.getCampaign({ id: c.id })).status, 'draft', 'a refused audience leaves the status alone');
  });

  await t.test('segments and tag filters need a top-level operator', async () => {
    const svc = build(fakeProvider());
    await assert.rejects(
      svc.createCampaign({ staff, ...content, audience: { kind: 'segment', segments: ['VIP'] } }),
      (e) => e.code === 'PUSH_AUDIENCE_NOT_ALLOWED'
    );
    await assert.rejects(
      svc.createCampaign({ staff, ...content, audience: { kind: 'filters', filters: [{ tag: 'vip_level', relation: '>', value: '3' }], match: 'all' } }),
      (e) => e.code === 'PUSH_AUDIENCE_NOT_ALLOWED'
    );
  });

  await t.test('"all" from a non-root operator is their own tree by external id', async () => {
    const a = await seedPlayer(newUid());
    const provider = fakeProvider();
    const svc = build(provider);
    const c = await svc.createCampaign({ staff, ...content, audience: { kind: 'all' } });
    const sent = await svc.sendCampaign({ staff, id: c.id });
    assert.equal(sent.status, 'sent');
    assert.equal(provider.calls[0].kind, 'users');
    assert.ok(provider.calls[0].ids.includes(String(a)));
    assert.ok(sent.inboxRows >= 1);
  });

  await t.test('no push provider: inbox-only send is "sent" with a note; nothing to write = failed', async () => {
    const a = await seedPlayer(newUid());
    const svc = build(null);
    const c = await svc.createCampaign({ staff, ...content, audience: { kind: 'players', userIds: [a] } });
    const sent = await svc.sendCampaign({ staff, id: c.id });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.accepted, 0);
    assert.match(sent.error, /inbox only/);

    const c2 = await svc.createCampaign({ staff, ...content, inbox: false, audience: { kind: 'players', userIds: [a] } });
    const failed = await svc.sendCampaign({ staff, id: c2.id });
    assert.equal(failed.status, 'failed');
    await assert.rejects(svc.testSend({ staff, userId: a, ...content }), (e) => e.code === 'PUSH_PUSH_NOT_CONFIGURED');
  });

  await t.test('schedule → due → sent by the scheduler; cancel stops it', async () => {
    const a = await seedPlayer(newUid());
    const provider = fakeProvider();
    const svc = build(provider);

    const soon = new Date(Date.now() + 60_000);
    const c = await svc.createCampaign({ staff, ...content, sendAt: soon, audience: { kind: 'players', userIds: [a] } });
    assert.equal(c.status, 'scheduled');

    const cancelled = await svc.createCampaign({ staff, ...content, sendAt: soon, audience: { kind: 'players', userIds: [a] } });
    assert.equal((await svc.cancelCampaign({ staff, id: cancelled.id })).status, 'cancelled');
    await assert.rejects(svc.cancelCampaign({ staff, id: cancelled.id }), (e) => e.code === 'PUSH_BAD_STATE');

    await assert.rejects(svc.scheduleCampaign({ staff, id: c.id, sendAt: new Date(Date.now() - 3600_000) }), (e) => e.code === 'PUSH_SEND_AT_PAST');

    // Make it due.
    await sql.query(`UPDATE push_campaigns SET send_at = NOW() - INTERVAL '1 second' WHERE id IN (:ids)`, { replacements: { ids: [c.id, cancelled.id] } });
    const ran = await svc.runDue();
    assert.ok(ran.some((r) => r.id === c.id && r.status === 'sent'));
    assert.ok(!ran.some((r) => r.id === cancelled.id), 'a cancelled campaign is never sent');
    assert.equal((await svc.runDue()).filter((r) => r.id === c.id).length, 0, 'and a sent one never twice');

    const del = await svc.deleteCampaign({ id: cancelled.id });
    assert.equal(del.deleted, true);
    await assert.rejects(svc.deleteCampaign({ id: c.id }), (e) => e.code === 'PUSH_BAD_STATE', 'a sent campaign is history');
  });

  await t.test('uploaded image is stored, served by its URL, and the URL is absolute', async () => {
    const svc = build(null);
    const up = await svc.uploadImage({ staff, file: { buffer: png(1440, 720) } });
    assert.match(up.url, /^https:\/\/play\.example\.test\/api\/v1\/admin\/push\/images\/\d+-[0-9a-f]{12}\.png$/);
    assert.deepEqual([up.width, up.height], [1440, 720]);
    const file = up.path.split('/').pop();
    const img = await svc.imageBytes({ file });
    assert.equal(img.contentType, 'image/png');
    await assert.rejects(svc.imageBytes({ file: file.replace(/-[0-9a-f]{12}/, '-000000000000') }), (e) => e.code === 'PUSH_IMAGE_NOT_FOUND');
    await sql.query('DELETE FROM push_images WHERE id = :id', { replacements: { id: up.id } });
  });

  await t.test('settings: defaults, save, public origin override', async () => {
    const svc = build(null);
    const s = await svc.settings();
    assert.equal(s.prompt.cooldownDays, 7);
    assert.equal(s.prompt.allowLabel, 'Allow');
    const saved = await svc.saveSettings({ staff, prompt: { ...s.prompt, title: 'Stay in the loop', delaySeconds: 5 }, publicOrigin: 'https://cdn.example.com/' });
    assert.equal(saved.prompt.title, 'Stay in the loop');
    assert.equal(saved.publicOrigin, 'https://cdn.example.com');
    assert.equal(await svc.origin(), 'https://cdn.example.com');
    assert.equal((await svc.publicPrompt()).delaySeconds, 5);
    await sql.query('DELETE FROM push_settings');
  });

  // ── Automatic event pushes (templates + notifyPlayer) ─────────────────

  const notifier = (provider) =>
    new NotificationsService({
      models: connection.models,
      logger,
      config,
      features: { pushProvider: async () => provider },
    });

  await t.test('event push with no template: the caller’s copy, click URL from the link', async () => {
    const uid = await seedPlayer(newUid());
    const provider = fakeProvider();
    const out = await notifier(provider).notifyPlayer({
      userId: uid,
      type: 'deposit_approved',
      title: 'Deposit approved',
      body: '500.00 INR has been added to your wallet (deposit #77).',
      data: { kind: 'deposit_approved', link: '#transactions', meta: { amount: '500', currency: 'INR', depositId: 77 }, template: '{amount} has been added to your wallet (deposit #77).' },
      dedupeKey: `fiat-deposit:approved:${uid}`,
    });
    assert.equal(out.created, true);
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].message.title, 'Deposit approved');
    assert.equal(provider.calls[0].message.url, 'https://play.example.test/#transactions');
    const [row] = await connection.models.UserNotifications.findAll({ where: { user_id: uid }, raw: true });
    assert.equal(row.additional_data.template, '{amount} has been added to your wallet (deposit #77).', 'the caller’s data is untouched');
  });

  await t.test('a customised template renders for push AND bell; disabled = bell only', async () => {
    const svc = build(null);
    const tpl = await svc.putTemplate({
      staff,
      kind: 'vip_level_up',
      enabled: true,
      title: 'Level {level} unlocked!',
      body: 'Enjoy {amount} on us.',
      imageUrl: 'https://cdn.example.com/vip.png',
      url: '/vip?from=push',
    });
    assert.equal(tpl.customised, true);

    const uid = await seedPlayer(newUid());
    const provider = fakeProvider();
    await notifier(provider).notifyPlayer({
      userId: uid,
      type: 'vip_level_up',
      title: 'VIP level 4 reached',
      body: '10.00 USDT VIP reward has been added to your wallet.',
      data: { kind: 'vip_level_up', link: '/vip', meta: { amount: '10', currency: 'USDT', level: 4 } },
      dedupeKey: 'vip:level_up:4',
    });
    const m = provider.calls[0].message;
    assert.equal(m.title, 'Level 4 unlocked!');
    assert.equal(m.body, 'Enjoy 10.00 USDT on us.');
    assert.equal(m.imageUrl, 'https://cdn.example.com/vip.png');
    assert.equal(m.url, 'https://play.example.test/vip?from=push');
    const [row] = await connection.models.UserNotifications.findAll({ where: { user_id: uid }, raw: true });
    assert.equal(row.title, 'Level 4 unlocked!');
    assert.equal(row.additional_data.image, 'https://cdn.example.com/vip.png');
    assert.equal(row.additional_data.template, 'Enjoy {amount} on us.');

    await svc.putTemplate({ staff, kind: 'vip_level_up', enabled: false, title: 'x', body: 'y' });
    const uid2 = await seedPlayer(newUid());
    const p2 = fakeProvider();
    const out = await notifier(p2).notifyPlayer({ userId: uid2, type: 'vip_level_up', title: 'VIP', body: 'b', data: { meta: {} }, dedupeKey: 'vip:level_up:5' });
    assert.equal(out.created, true, 'the bell row is still written');
    assert.equal(p2.calls.length, 0, 'but nothing is pushed');

    const reset = await svc.resetTemplate({ kind: 'vip_level_up' });
    assert.equal(reset.customised, false);
    assert.equal(reset.title, 'VIP level {level} reached');
  });

  await t.test('templates list covers every event kind with defaults', async () => {
    const list = await build(null).listTemplates();
    for (const kind of ['deposit_approved', 'deposit_rejected', 'withdrawal_paid', 'kyc_approved', 'vip_level_up', 'first_deposit_bonus', 'affiliate_reward']) {
      assert.ok(list.find((t2) => t2.kind === kind), kind);
    }
    assert.ok(list.every((t2) => t2.enabled && !t2.customised));
  });
});
