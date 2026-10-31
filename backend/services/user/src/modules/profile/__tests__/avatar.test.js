'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { ProfileService } = require('../profile.service');
const v = require('../profile.validators');

/**
 * `POST /user/profile/avatar` — the VIP-level gate, with the admin call and the models stubbed.
 * The ladder is the platform one (no SiteFeature model): level 0 at no wager.
 */

function serviceWith({ avatar, adminError, wager = '0' } = {}) {
  const writes = [];
  const service = new ProfileService({
    models: {
      Userwager: { findOne: async () => ({ wager }) },
      Users: {
        update: async (patch) => {
          writes.push(patch);
          return [1];
        },
        findByPk: async () => ({ id: 5, name: 'p', avatar: writes.at(-1)?.avatar ?? null, level: 1 }),
      },
    },
    clients: {
      admin: {
        get: async () => {
          if (adminError) throw adminError;
          return avatar;
        },
      },
    },
  });
  return { service, writes };
}

test('an unlocked avatar is stored as its URL and the profile comes back', async () => {
  const url = '/api/v1/admin/avatars/1/image?v=x';
  const { service, writes } = serviceWith({ avatar: { id: 1, url, minLevel: 0, enabled: true } });
  const profile = await service.setAvatar(5, 1);
  assert.deepStrictEqual(writes, [{ avatar: url }]);
  assert.strictEqual(profile.avatar, url);
  assert.strictEqual(profile.vipLevel, 0);
});

test('one above the player VIP level is AVATAR_LOCKED and writes nothing', async () => {
  const { service, writes } = serviceWith({ avatar: { id: 12, url: '/x', minLevel: 5, enabled: true } });
  await assert.rejects(service.setAvatar(5, 12), (e) => e.code === 'AVATAR_LOCKED' && e.status === 403 && e.details.minLevel === 5 && e.details.level === 0);
  assert.deepStrictEqual(writes, []);
});

test('a missing or switched-off avatar is AVATAR_NOT_FOUND', async () => {
  const gone = Object.assign(new Error('nope'), { status: 404 });
  await assert.rejects(serviceWith({ adminError: gone }).service.setAvatar(5, 99), { code: 'AVATAR_NOT_FOUND' });
  await assert.rejects(
    serviceWith({ avatar: { id: 3, url: '/x', minLevel: 0, enabled: false } }).service.setAvatar(5, 3),
    { code: 'AVATAR_NOT_FOUND' }
  );
});

test('an admin-service outage is not reported as a missing avatar', async () => {
  const down = Object.assign(new Error('down'), { status: 503 });
  await assert.rejects(serviceWith({ adminError: down }).service.setAvatar(5, 1), (e) => e.status === 503);
});

test('the body is one positive avatar id', () => {
  assert.strictEqual(v.setAvatar.body.parse({ avatarId: '4' }).avatarId, 4);
  assert.throws(() => v.setAvatar.body.parse({ avatarId: 0 }));
  assert.throws(() => v.setAvatar.body.parse({ avatarId: 1, url: '/evil' }));
});
