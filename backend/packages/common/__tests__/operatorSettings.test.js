'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { operatorSettings } = require('../src/operatorSettings');

const tick = () => new Promise((resolve) => setImmediate(resolve));

function adminClient(answers) {
  const calls = [];
  return {
    calls,
    get(path) {
      calls.push(path);
      const next = answers.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve({ success: true, data: next });
    },
  };
}

test('no admin client reads as the fallback', async () => {
  const settings = operatorSettings({ clients: {} });
  assert.equal(settings.value('deposit_maximum', '1000'), '1000');
  assert.equal(await settings.read('deposit_maximum', '1000'), '1000');
});

test('the fallback answers until the first read lands, then the stored value does', async () => {
  const admin = adminClient([{ deposit_maximum: '250', race_timezone: null }]);
  const settings = operatorSettings({ clients: { admin } });

  assert.equal(settings.value('deposit_maximum', '1000'), '1000');
  await tick();
  assert.equal(settings.value('deposit_maximum', '1000'), '250');
  // A key nobody set, in the environment or the admin, stays the caller's own default.
  assert.equal(settings.value('race_timezone', 'Asia/Kolkata'), 'Asia/Kolkata');
  assert.deepEqual(admin.calls, ['/internal/admin/site-config/settings']);
});

test('one cache per admin client', async () => {
  const admin = adminClient([{ deposit_maximum: '250' }]);
  const a = operatorSettings({ clients: { admin } });
  const b = operatorSettings({ clients: { admin } });
  assert.equal(a, b);
  await tick();
  assert.equal(admin.calls.length, 1);
});

test('an outage keeps the last good values and does not ask again inside the TTL', async () => {
  const admin = adminClient([{ deposit_maximum: '250' }, new Error('ECONNREFUSED')]);
  const warnings = [];
  const settings = operatorSettings({ clients: { admin }, config: { OPERATOR_SETTINGS_TTL_MS: 0 }, logger: { warn: (...a) => warnings.push(a) } });
  await tick();

  assert.equal(await settings.read('deposit_maximum', '1000'), '250'); // TTL 0 → refreshes, fails, keeps 250
  assert.equal(warnings.length, 1);
  assert.equal(admin.calls.length, 2);
});

test('an outage before any answer reads as the fallback', async () => {
  const admin = adminClient([new Error('ECONNREFUSED')]);
  const settings = operatorSettings({ clients: { admin }, logger: { warn() {} } });
  await tick();
  assert.equal(settings.value('deposit_maximum', '1000'), '1000');
});
