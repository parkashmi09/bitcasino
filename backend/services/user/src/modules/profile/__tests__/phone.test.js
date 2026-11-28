'use strict';

/* Mobile number (hash f3a287c6, 2026-11-27): the shared `phone` rule, sign-up taking it optionally,
   the owner's `phone_required` policy making it mandatory, and ProfileService.setPhone filling an
   empty number only, uniquely. */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const v = require('../profile.validators');
const auth = require('../../auth/auth.validators');
const { ProfileService } = require('../profile.service');
const { AuthService } = require('../../auth/auth.service');

test('phone: separators dropped, 10-15 digits with optional +', () => {
  assert.equal(v.phone.parse('+91 98765-43210'), '+919876543210');
  assert.equal(v.phone.parse(' (987) 654.3210 '), '9876543210');
  for (const bad of ['', '12345', '98765abcde', '+1234567890123456']) {
    assert.equal(v.phone.safeParse(bad).success, false, bad);
  }
});

test('register: phone optional, normalised when given, empty box = not given', () => {
  const base = { username: 'newplayer', password: 'longenough', email: 'a@b.co' };
  assert.equal(auth.register.body.parse(base).phone, undefined);
  assert.equal(auth.register.body.parse({ ...base, phone: '' }).phone, undefined);
  assert.equal(auth.register.body.parse({ ...base, phone: '98765 43210' }).phone, '9876543210');
  assert.equal(auth.register.body.safeParse({ ...base, phone: '12345' }).success, false);
});

function authWith(variant, entitled = true) {
  const service = Object.create(AuthService.prototype);
  const rows = { phone_required: variant };
  service.models = { SiteFeature: { findByPk: async (key) => (rows[key] ? { variant: rows[key] } : null) } };
  service.entitlements = { isFeatureEntitled: async () => entitled };
  service.region = { assertAllowed: async () => {} };
  return service;
}

test('phone_required policy: required refuses a sign-up without a number', async () => {
  const required = authWith('required');
  assert.equal(await required.phoneRequired(), true);
  await assert.rejects(required.register({ username: 'newplayer', password: 'longenough' }), (e) => /PHONE_REQUIRED/.test(e.code));
  assert.equal(await authWith(null).phoneRequired(), false);
  assert.equal(await authWith('none').phoneRequired(), false);
  assert.equal(await authWith('required', false).phoneRequired(), false);
});

function serviceWith({ user, taken = null }) {
  const updates = [];
  const row = { ...user, update: async (changes) => { updates.push(changes); Object.assign(row, changes); } };
  const service = new ProfileService({
    models: { Users: { findByPk: async () => row, findOne: async () => taken } },
    logger: null,
  });
  service.get = async () => ({ id: row.id, phone: row.phone });
  return { service, updates };
}

test('setPhone fills an empty number', async () => {
  const { service, updates } = serviceWith({ user: { id: 1, phone: null } });
  assert.deepEqual(await service.setPhone(1, '9876543210'), { id: 1, phone: '9876543210' });
  assert.deepEqual(updates, [{ phone: '9876543210' }]);
});

test('setPhone refuses an account that already has one, and a number in use', async () => {
  const has = serviceWith({ user: { id: 1, phone: '9999999999' } });
  await assert.rejects(has.service.setPhone(1, '9876543210'), (e) => /PHONE_ALREADY_SET/.test(e.code));
  assert.equal(has.updates.length, 0);
  const clash = serviceWith({ user: { id: 1, phone: '' }, taken: { id: 2 } });
  await assert.rejects(clash.service.setPhone(1, '9876543210'), (e) => /PHONE_TAKEN/.test(e.code));
  assert.equal(clash.updates.length, 0);
});
