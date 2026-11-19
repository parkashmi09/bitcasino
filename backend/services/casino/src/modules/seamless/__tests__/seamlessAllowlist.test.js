'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const publicRoutes = require('../routes/public.routes');
const { auditProductionConfig } = require('../../../../../../packages/common/src/productionGuards');

const mount = (allowed) => {
  const warned = [];
  publicRoutes({
    config: { SEAMLESS_ALLOWED_IPS: allowed, RATE_LIMIT_ENABLED: false },
    logger: { warn: (message) => warned.push(message), info() {}, error() {} },
    models: {},
    db: {},
    wallet: {},
  });
  return warned;
};

test('an empty seamless allowlist warns at startup, a set one does not', () => {
  assert.match(mount([])[0], /SEAMLESS_ALLOWED_IPS is empty/);
  assert.deepEqual(mount(['10.0.0.1']), []);
});

test('production boot warns about the legacy signature and does not refuse it', () => {
  const { fatal, warn } = auditProductionConfig({ NODE_ENV: 'production', SEAMLESS_SIGN_MODE: 'legacy' });
  assert.equal(fatal.some((m) => m.includes('SEAMLESS_SIGN_MODE')), false);
  assert.equal(warn.some((m) => m.includes('SEAMLESS_SIGN_MODE=legacy')), true);
});
