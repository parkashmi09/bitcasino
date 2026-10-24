'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolveCredentials } = require('../src/sequelize');

/**
 * Which Postgres role a service connects as.
 *
 * All four connected as one user with full rights on the whole database.
 * `SERVICE_DOMAINS` looks like isolation but only decides which Sequelize
 * models get registered — nothing stopped sports-service running
 * `SELECT * FROM users`, so a compromise of the odds-feed poller was a
 * compromise of every player record and password hash.
 *
 * These tests are mostly about the FALLBACK, because that is the property that
 * makes the change safe to deploy: with nothing configured, every service
 * connects exactly as it did before.
 */

const base = {
  DB_USER: 'postgres',
  DB_PASSWORD: 'shared-password',
};

test('per-service database credentials', async (t) => {
  await t.test('a service with its own role uses it', () => {
    const { username, password, scoped } = resolveCredentials({
      ...base,
      SERVICE_NAME: 'sports-service',
      DB_USER_SPORTS_SERVICE: 'ibitplay_sports',
      DB_PASSWORD_SPORTS_SERVICE: 'sports-password',
    });

    assert.equal(username, 'ibitplay_sports');
    assert.equal(password, 'sports-password');
    assert.equal(scoped, true);
  });

  await t.test('a service with no role falls back to the shared user', () => {
    /**
     * The whole backward-compatibility story. An unmigrated deployment sets
     * none of these and must connect precisely as before.
     */
    const { username, password, scoped } = resolveCredentials({
      ...base,
      SERVICE_NAME: 'sports-service',
    });

    assert.equal(username, 'postgres');
    assert.equal(password, 'shared-password');
    assert.equal(scoped, false);
  });

  await t.test('one service adopting a role does not affect the others', () => {
    /**
     * Roles are adopted one service at a time, not in a flag day across four.
     */
    const config = {
      ...base,
      DB_USER_SPORTS_SERVICE: 'ibitplay_sports',
      DB_PASSWORD_SPORTS_SERVICE: 'sports-password',
    };

    assert.equal(resolveCredentials({ ...config, SERVICE_NAME: 'sports-service' }).username, 'ibitplay_sports');
    assert.equal(resolveCredentials({ ...config, SERVICE_NAME: 'casino-service' }).username, 'postgres');
    assert.equal(resolveCredentials({ ...config, SERVICE_NAME: 'user-service' }).username, 'postgres');
  });

  await t.test('a username with no password falls back rather than half-scoping', () => {
    /**
     * Pairing the scoped username with the SHARED password would connect as
     * the wrong principal — or fail outright — while the config read as though
     * isolation were in place. Falling back is both safer and honest.
     */
    const { username, scoped } = resolveCredentials({
      ...base,
      SERVICE_NAME: 'sports-service',
      DB_USER_SPORTS_SERVICE: 'ibitplay_sports',
    });

    assert.equal(username, 'postgres');
    assert.equal(scoped, false);
  });

  await t.test('a password with no username is ignored too', () => {
    const { username, password } = resolveCredentials({
      ...base,
      SERVICE_NAME: 'sports-service',
      DB_PASSWORD_SPORTS_SERVICE: 'orphaned',
    });

    assert.equal(username, 'postgres');
    assert.equal(password, 'shared-password');
  });

  await t.test('an empty string is treated as unset', () => {
    const { username, scoped } = resolveCredentials({
      ...base,
      SERVICE_NAME: 'sports-service',
      DB_USER_SPORTS_SERVICE: '',
      DB_PASSWORD_SPORTS_SERVICE: '',
    });

    assert.equal(username, 'postgres');
    assert.equal(scoped, false);
  });

  await t.test('a caller with no service name gets the shared user', () => {
    // Migrations and CLI tools connect without a SERVICE_NAME, and they need
    // the full-rights user — a scoped role could not run DDL.
    const { username, scoped } = resolveCredentials(base);
    assert.equal(username, 'postgres');
    assert.equal(scoped, false);
  });

  await t.test('the env var name is derived from the service name', () => {
    for (const [service, envUser] of [
      ['user-service', 'DB_USER_USER_SERVICE'],
      ['admin-service', 'DB_USER_ADMIN_SERVICE'],
      ['casino-service', 'DB_USER_CASINO_SERVICE'],
      ['sports-service', 'DB_USER_SPORTS_SERVICE'],
    ]) {
      const { username } = resolveCredentials({
        ...base,
        SERVICE_NAME: service,
        [envUser]: 'scoped-role',
        [envUser.replace('DB_USER', 'DB_PASSWORD')]: 'pw',
      });
      assert.equal(username, 'scoped-role', `${service} should read ${envUser}`);
    }
  });
});
