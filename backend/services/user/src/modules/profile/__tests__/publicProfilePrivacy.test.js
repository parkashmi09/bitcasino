'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { ProfileService } = require('../profile.service');

/**
 * `GET /user/profile/:userId/public` hides the name on the same switches as the
 * public bets feed: Show Bets Publicly off, or Hide Username on. No database:
 * the models are stubbed.
 */

const serviceWith = (prefs) =>
  new ProfileService({
    models: {
      Users: { findByPk: async () => ({ id: 7, name: 'alice', avatar: null, created: null, games_played: 3 }) },
      Userwager: { findOne: async () => null },
      Userconfig: { findOne: async () => prefs },
    },
    clients: { casino: { get: async () => ({ bets: 1, wins: 0 }) } },
  });

test('public profile: the username follows the privacy switches', async () => {
  const shown = await serviceWith(null).publicProfile(7);
  assert.strictEqual(shown.username, 'alice');
  assert.strictEqual(shown.usernameHidden, false);

  for (const prefs of [{ show_bets_publicly: false }, { hide_username: true }]) {
    const hidden = await serviceWith(prefs).publicProfile(7);
    assert.strictEqual(hidden.username, null, JSON.stringify(prefs));
    assert.strictEqual(hidden.usernameHidden, true);
    assert.strictEqual(hidden.userId, '7');
  }
});
