'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createLogger } = require('@ibitplay/common');
const { LITERAL_EVENTS, PLATFORM_EVENTS, AUDIENCE, decode } = require('@ibitplay/socket');

const preferenceSockets = require('../sockets');

/**
 * `getSiteConfig` — the site's public config, loaded over the socket.
 *
 * No database: the snapshot is admin-service's, so the client is stubbed.
 */

const logger = createLogger({ name: 'site-config-socket-test', level: 'silent' });

function registerWith(admin) {
  const registered = new Map();
  preferenceSockets.register({
    on: (event, spec) => registered.set(event, spec),
    deps: { logger, clients: { admin } },
  });
  return registered.get(PLATFORM_EVENTS.GET_SITE_CONFIG);
}

function fakeSocket() {
  const emitted = [];
  return { emitted, socket: { emit: (event, frame) => emitted.push([event, decode(frame)]) } };
}

const SNAPSHOT = {
  flags: { vipclub: true, casino: false },
  features: [{ feature: 'vip', variant: 'addaplay' }, { feature: 'business_model', kind: 'policy', variant: 'b2b' }],
};

test('getSiteConfig', async (t) => {
  await t.test('is open to a signed-out visitor', () => {
    const spec = registerWith({ get: async () => SNAPSHOT });
    assert.strictEqual(spec.audience, AUDIENCE.PUBLIC);
  });

  await t.test('answers with the snapshot and pushes both halves to the asking socket', async () => {
    const asked = [];
    const spec = registerWith({
      get: async (path) => {
        asked.push(path);
        return SNAPSHOT;
      },
    });
    const { emitted, socket } = fakeSocket();

    const reply = await spec.handle({}, { userId: null, socket });

    assert.deepStrictEqual(asked, ['/internal/admin/site-config/public']);
    assert.strictEqual(reply.status, true);
    assert.deepStrictEqual(reply.flags, SNAPSHOT.flags);
    assert.deepStrictEqual(reply.features, SNAPSHOT.features);
    assert.deepStrictEqual(emitted, [
      [LITERAL_EVENTS.SITE_CONFIG_UPDATED, SNAPSHOT.flags],
      [PLATFORM_EVENTS.FEATURES_UPDATED, SNAPSHOT.features],
    ]);
  });

  await t.test('reads a response still wrapped in `data`', async () => {
    const spec = registerWith({ get: async () => ({ data: SNAPSHOT }) });
    const reply = await spec.handle({}, { socket: fakeSocket().socket });
    assert.deepStrictEqual(reply.flags, SNAPSHOT.flags);
  });

  await t.test('an unreachable admin-service is a refusal, not defaults', async () => {
    const spec = registerWith({
      get: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const { emitted, socket } = fakeSocket();

    const reply = await spec.handle({}, { socket });

    // A reply of empty flags would read as "the operator switched everything
    // off"; a refusal lets the client keep what it has and fall back to HTTP.
    assert.strictEqual(reply.status, false);
    assert.strictEqual(reply.error.code, 'SITE_CONFIG_UNAVAILABLE');
    assert.deepStrictEqual(emitted, []);
  });
});
