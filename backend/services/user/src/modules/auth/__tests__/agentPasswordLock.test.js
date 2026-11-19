'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { AuthService } = require('../auth.service');

/** Runs changePassword against one stored player, with no database. */
const changeAs = (stored) =>
  AuthService.prototype.changePassword.call(
    { models: { Users: { findByPk: async () => stored } } },
    { currentPassword: 'whatever', newPassword: 'Another1!' },
    { id: 1 }
  );

test("an agent's player cannot change their own password", async () => {
  await assert.rejects(changeAs({ id: 1, parent_staff_id: 7, password: null }), (error) => /OWN_PASSWORD_LOCKED/.test(error.code));
});

test('a direct player reaches the current-password check', async () => {
  await assert.rejects(changeAs({ id: 1, parent_staff_id: null, password: null }), (error) => /CURRENT_PASSWORD_INCORRECT/.test(error.code));
});
