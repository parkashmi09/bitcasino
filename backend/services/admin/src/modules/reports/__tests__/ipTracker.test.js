'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { ReportsService } = require('../reports.service');
const { isPrivateIp } = require('../ipTracker');
const v = require('../reports.validators');

/**
 * The staff IP tracker.
 *
 * What this proves:
 *   1. an agent sees only logins from their own tree, and a shared IP counts
 *      only the accounts they may see — a rival's player on the same address
 *      is not even a number;
 *   2. the filters (IP exact/prefix, country, date range, VPN/proxy, event,
 *      user search) narrow the rows they say they do;
 *   3. the shared-IP view groups by address and lists the accounts behind it.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextId = 710_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('ip tracker validators', async (t) => {
  await t.test('an IP filter carries no LIKE wildcard of the caller', () => {
    assert.equal(v.ipTracker.query.safeParse({ ip: '10.0.%' }).success, false);
    assert.equal(v.ipTracker.query.safeParse({ ip: '10_0' }).success, false);
    assert.equal(v.ipTracker.query.safeParse({ ip: '10.0.*' }).success, true);
    assert.equal(v.ipTracker.query.safeParse({ ip: '2001:db8::1' }).success, true);
  });

  await t.test('dates are days, in order', () => {
    assert.equal(v.ipTracker.query.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success, false);
    assert.equal(v.ipTracker.query.safeParse({ from: 'yesterday' }).success, false);
    assert.equal(v.sharedIps.query.parse({ proxyOnly: 'true' }).proxyOnly, true);
  });

  await t.test('no stray parameters, and the page size has a ceiling', () => {
    assert.equal(v.ipTracker.query.safeParse({ email: 'x' }).success, false);
    assert.equal(v.ipTracker.query.safeParse({ limit: '5000' }).success, false);
  });

  await t.test('loopback and private addresses are recognised', () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.9', '172.20.1.1', '::ffff:127.0.0.1']) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '203.0.113.7', null]) {
      assert.equal(isPrivateIp(ip), false, String(ip));
    }
  });
});

test('ip tracker against a database', async (t) => {
  const logger = createLogger({ name: 'ip-tracker-test', level: 'silent' });

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
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const service = new ReportsService({ models, db: connection, logger, config: {} });

  const agentA = newId();
  const subAgent = newId();
  const agentB = newId();
  const superStaff = newId();
  const playerA1 = newId();
  const playerA2 = newId();
  const playerB = newId();
  const players = [playerA1, playerA2, playerB];
  const staffIds = [subAgent, agentA, agentB, superStaff];

  // Documentation ranges, unique per run so other rows never match.
  const n = (process.pid % 250) + 1;
  const SHARED = `198.51.100.${n}`;
  const PROXY = `203.0.113.${n}`;

  const cleanup = async () => {
    await models.UserLoginHistory.destroy({ where: { user_id: players } });
    await models.Users.destroy({ where: { id: players } });
    await models.Staff.destroy({ where: { id: staffIds } });
  };

  // Registered first, so a failed setup assertion still closes the pool.
  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  /**
   * agentA ── subAgent ── playerA2
   *       └── playerA1
   * agentB ── playerB
   * superStaff (a level-0/1 back-office role) sees every tree.
   */
  const agentRole = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  const superRole = (await models.Roles.findOne({ where: { level: [0, 1] }, order: [['level', 'ASC']], raw: true }))?.id;
  assert.ok(agentRole && superRole, 'the test database needs an agent role and a super-admin role');

  t.before(async () => {
    await cleanup();
    const staff = (id, name, role, parent) => ({
      id, name: `${name}-${id}`, email: `${name}${id}@t.test`, password: 'x', role_id: role, parent_id: parent,
    });
    await models.Staff.bulkCreate([
      staff(agentA, 'ipt-a', agentRole, null),
      staff(agentB, 'ipt-b', agentRole, null),
      staff(superStaff, 'ipt-super', superRole, null),
    ]);
    await models.Staff.create(staff(subAgent, 'ipt-sub', agentRole, agentA));
    await models.Users.bulkCreate([
      { id: playerA1, name: `ipt-alpha-${playerA1}`, password: 'x', status: 'active', parent_staff_id: agentA },
      { id: playerA2, name: `ipt-beta-${playerA2}`, password: 'x', status: 'active', parent_staff_id: subAgent },
      { id: playerB, name: `ipt-rival-${playerB}`, password: 'x', status: 'active', parent_staff_id: agentB },
    ]);
    const at = (s) => new Date(`${s}T12:00:00Z`);
    await models.UserLoginHistory.bulkCreate([
      { user_id: playerA1, ip_address: SHARED, source: 'register', country_code: 'IN', country: 'India', created_at: at('2026-01-05') },
      { user_id: playerA1, ip_address: PROXY, source: 'login', country_code: 'DE', country: 'Germany', is_proxy: true, created_at: at('2026-02-10') },
      { user_id: playerA2, ip_address: SHARED, source: 'login', country_code: 'IN', country: 'India', created_at: at('2026-01-20') },
      { user_id: playerB, ip_address: SHARED, source: 'login', country_code: 'IN', country: 'India', created_at: at('2026-01-25') },
    ]);
  });

  const asA = { id: agentA, permissions: ['*'] };
  const asB = { id: agentB, permissions: ['*'] };
  const asSub = { id: subAgent, permissions: ['*'] };
  const asOwner = { id: superStaff, permissions: ['*'] };
  const ours = { ip: `${SHARED.split('.').slice(0, 3).join('.')}.*` };
  const userIds = (result) => result.rows.map((r) => r.user.id).sort();

  // ── Scope ────────────────────────────────────────────────────────────

  await t.test('an agent sees only logins from their own tree', async () => {
    const seen = await service.ipTracker({ staff: asA, ip: SHARED, limit: 100 });
    assert.deepEqual(userIds(seen), [String(playerA1), String(playerA2)].sort());
    assert.equal(seen.total, 2);

    const rival = await service.ipTracker({ staff: asB, ip: SHARED, limit: 100 });
    assert.deepEqual(userIds(rival), [String(playerB)]);
  });

  await t.test("a master sees their sub-agent's players; the sub-agent sees only their own", async () => {
    const master = await service.ipTracker({ staff: asA, search: String(playerA2), limit: 100 });
    assert.equal(master.total, 1, "agent A reaches a player two levels down");
    const sub = await service.ipTracker({ staff: asSub, ip: SHARED, limit: 100 });
    assert.deepEqual(userIds(sub), [String(playerA2)]);
  });

  await t.test("an agent cannot reach a rival's player by searching for them", async () => {
    const byId = await service.ipTracker({ staff: asA, search: String(playerB), limit: 100 });
    assert.equal(byId.total, 0);
    const byName = await service.ipTracker({ staff: asA, search: `ipt-rival-${playerB}`, limit: 100 });
    assert.equal(byName.total, 0);
  });

  await t.test('a super admin sees every tree', async () => {
    const seen = await service.ipTracker({ staff: asOwner, ip: SHARED, limit: 100 });
    assert.deepEqual(userIds(seen), players.map(String).sort());
  });

  // ── Filters ──────────────────────────────────────────────────────────

  await t.test('IP: exact, and prefix', async () => {
    const exact = await service.ipTracker({ staff: asA, ip: PROXY, limit: 100 });
    assert.equal(exact.total, 1);
    assert.equal(exact.rows[0].ipAddress, PROXY);

    // A prefix that is not a whole address matches nothing exactly...
    const partial = await service.ipTracker({ staff: asA, ip: '198.51.100', limit: 100 });
    assert.equal(partial.rows.some((r) => r.ipAddress === SHARED), false);
    // ...and everything under it with a trailing `*` or `.`.
    const star = await service.ipTracker({ staff: asA, ...ours, limit: 100 });
    assert.equal(star.rows.filter((r) => r.ipAddress === SHARED).length, 2);
    const dot = await service.ipTracker({ staff: asA, ip: '198.51.100.', limit: 100 });
    assert.equal(dot.rows.filter((r) => r.ipAddress === SHARED).length, 2);
  });

  await t.test('VPN/proxy only', async () => {
    const seen = await service.ipTracker({ staff: asA, search: String(playerA1), proxyOnly: true, limit: 100 });
    assert.equal(seen.total, 1);
    assert.equal(seen.rows[0].ipAddress, PROXY);
    assert.equal(seen.rows[0].isProxy, true);
  });

  await t.test('country: by code or by name', async () => {
    const code = await service.ipTracker({ staff: asA, search: String(playerA1), country: 'de', limit: 100 });
    assert.deepEqual(code.rows.map((r) => r.countryCode), ['DE']);
    const name = await service.ipTracker({ staff: asA, search: String(playerA1), country: 'Ind', limit: 100 });
    assert.deepEqual(name.rows.map((r) => r.country), ['India']);
  });

  await t.test('date range is inclusive of both days', async () => {
    const jan = await service.ipTracker({ staff: asA, ip: SHARED, from: '2026-01-05', to: '2026-01-05', limit: 100 });
    assert.deepEqual(userIds(jan), [String(playerA1)]);
    const later = await service.ipTracker({ staff: asA, ip: SHARED, from: '2026-01-06', limit: 100 });
    assert.deepEqual(userIds(later), [String(playerA2)]);
  });

  await t.test('event type, user search, and newest first', async () => {
    const reg = await service.ipTracker({ staff: asA, search: String(playerA1), source: 'register', limit: 100 });
    assert.deepEqual(reg.rows.map((r) => r.source), ['register']);

    const all = await service.ipTracker({ staff: asA, search: `ipt-alpha-${playerA1}`, limit: 100 });
    assert.equal(all.total, 2);
    assert.equal(all.rows[0].ipAddress, PROXY, 'the February login comes first');
    assert.equal(all.rows[0].user.name, `ipt-alpha-${playerA1}`);
  });

  await t.test('paging', async () => {
    const first = await service.ipTracker({ staff: asOwner, ip: SHARED, limit: 2, offset: 0 });
    const second = await service.ipTracker({ staff: asOwner, ip: SHARED, limit: 2, offset: 2 });
    assert.equal(first.total, 3);
    assert.equal(first.rows.length, 2);
    assert.equal(second.rows.length, 1);
  });

  // ── Shared IPs ───────────────────────────────────────────────────────

  await t.test('an address two accounts used is grouped, with its accounts', async () => {
    const seen = await service.sharedIps({ staff: asA, ip: SHARED });
    assert.equal(seen.total, 1);
    const [row] = seen.rows;
    assert.equal(row.ipAddress, SHARED);
    assert.equal(row.accounts, 2, "the rival's player is not counted");
    assert.equal(row.logins, 2);
    assert.deepEqual(row.countryCodes, ['IN']);
    assert.deepEqual(row.users.map((u) => u.id).sort(), [String(playerA1), String(playerA2)].sort());
  });

  await t.test('a super admin counts every account on the address', async () => {
    const seen = await service.sharedIps({ staff: asOwner, ip: SHARED });
    assert.equal(seen.rows[0].accounts, 3);
    assert.equal(seen.rows[0].users.length, 3);
  });

  await t.test('one account on an address is not "shared"', async () => {
    // Agent B sees only their own player on SHARED; the proxy IP is A1's alone.
    assert.equal((await service.sharedIps({ staff: asB, ip: SHARED })).total, 0);
    assert.equal((await service.sharedIps({ staff: asOwner, ip: PROXY })).total, 0);
  });

  await t.test('a user search keeps the addresses that player shares, with everyone on them', async () => {
    const seen = await service.sharedIps({ staff: asA, search: `ipt-beta-${playerA2}` });
    const row = seen.rows.find((r) => r.ipAddress === SHARED);
    assert.ok(row);
    assert.equal(row.users.length, 2, 'the other account is listed too');
    assert.equal((await service.sharedIps({ staff: asA, search: String(playerB) })).total, 0);
  });

  await t.test('the filters narrow the events before grouping', async () => {
    // Only A2 logged in from SHARED after 6 Jan, so in that window it is not shared.
    assert.equal((await service.sharedIps({ staff: asA, ip: SHARED, from: '2026-01-06' })).total, 0);
    assert.equal((await service.sharedIps({ staff: asA, ip: SHARED, proxyOnly: true })).total, 0);
  });

  // ── Direct Users | Agent Users tab ───────────────────────────────────

  await t.test('channel: agent keeps agent players, direct drops them; absent = both', async () => {
    assert.equal(v.ipTracker.query.parse({ channel: 'direct' }).channel, 'direct');
    assert.throws(() => v.ipTracker.query.parse({ channel: 'x' }));
    const agent = await service.ipTracker({ staff: asOwner, ip: SHARED, channel: 'agent', limit: 100 });
    assert.deepEqual(userIds(agent), players.map(String).sort());
    const direct = await service.ipTracker({ staff: asOwner, ip: SHARED, channel: 'direct', limit: 100 });
    assert.equal(direct.rows.filter((r) => players.map(String).includes(r.user.id)).length, 0);
    assert.equal((await service.sharedIps({ staff: asOwner, ip: SHARED, channel: 'direct' })).rows.filter((r) => r.ipAddress === SHARED && r.accounts > 1 && r.users.some((u) => players.map(String).includes(u.id))).length, 0);
  });
});
