'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword } = require('@ibitplay/auth');
const { TwoFactorService } = require('../twofa.service');

/** A wrong password while ENABLING 2FA answers with the setup message, not the "disable" one. */
const CONFIG = { JWT_ACCESS_SECRET: 'x'.repeat(48), JWT_REFRESH_SECRET: 'y'.repeat(48), JWT_ADMIN_SECRET: 'z'.repeat(48) };

test('completeSetup with a wrong password: TWOFA_SETUP_PASSWORD_REQUIRED, "turn on" wording', async () => {
  const password = await hashPassword('right-password-123', 4);
  const svc = new TwoFactorService({
    models: {
      User2fa: { findOne: async () => ({ secret_key: 'stored', is_enabled: false }) },
      Users: { findByPk: async () => ({ id: 7, password }) },
    },
    db: {},
    logger: null,
    config: CONFIG,
  });
  await assert.rejects(svc.completeSetup(7, { code: '123456', password: 'wrong' }), (e) => {
    assert.match(e.code, /SETUP_PASSWORD_REQUIRED$/);
    assert.match(e.message, /turn on/);
    return true;
  });
});
