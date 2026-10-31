'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const { AuthService } = require('../../auth/auth.service');
const { ProfileService } = require('../../profile/profile.service');
const { AffiliateService } = require('../affiliate.service');
const { resolveReferrerOwner } = require('../referrerResolver');

const { selectAgentTreeReferrals } = require(path.resolve(
  __dirname,
  '../../../../../../scripts/cleanup-agent-tree-referrals.js'
));

/**
 * An agent-tree player's referral code does not work at all — signup, the
 * public code check, joining a team. A direct player's code still does.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

test('resolver: an agent-tree winner is "not found" (no DB)', async (t) => {
  t.after(() => resetAgentPlayers());

  const agent = { id: 1, name: 'agentp', referalcode: 'AGENT1' };
  const direct = { id: 2, name: 'directp', referalcode: 'DIRECT2' };
  // Exact-code lookup only — enough for the rule.
  const models = {
    Users: {
      findOne: async ({ where }) => [agent, direct].find((u) => u.referalcode === where.referalcode) ?? null,
    },
  };
  configureAgentPlayers({ isAgentPlayer: async (id) => Number(id) === 1 });

  assert.equal(await resolveReferrerOwner(models, 'AGENT1'), null);
  assert.deepEqual(await resolveReferrerOwner(models, 'DIRECT2'), direct);
});

test('cleanup script selection', () => {
  const staff = [
    { id: 1, level: 1 }, // super admin (house)
    { id: 4, level: 4 }, // super master
    { id: 6, level: 6 }, // agent
    { id: 70, level: 7, parentLevel: 6 }, // executive under an agent
    { id: 71, level: 7, parentLevel: 2 }, // executive under an admin — agent tree too (user, 2026-10-29)
  ];
  const players = [
    { id: 10, name: 'house_p', referalcode: 'HOUSE10', parent_staff_id: 1 },
    { id: 11, name: 'sm_p', referalcode: 'SM11', parent_staff_id: 4 },
    { id: 12, name: 'ag_p', referalcode: 'AG12', parent_staff_id: 6 },
    { id: 13, name: 'ex_p', referalcode: 'EX13', parent_staff_id: 70 },
    { id: 14, name: 'hx_p', referalcode: 'HX14', parent_staff_id: 71 },
    { id: 15, name: 'nocode', referalcode: null, parent_staff_id: 6 },
  ];
  const teams = [
    { ownername: 'house_p', membername: 'm1', referalCode: 'HOUSE10' },
    { ownername: 'sm_p', membername: 'm2', referalCode: 'SM11' },
    { ownername: 'ag_p', membername: 'm3', referalCode: 'AG12' },
    { ownername: 'ex_p', membername: 'm4', referalCode: 'EX13' },
    { ownername: 'hx_p', membername: 'm5', referalCode: 'HX14' },
    { ownername: 'renamed', membername: 'm6', referalCode: 'AG12' }, // matched by code
    { ownername: 'direct', membername: 'm7', referalCode: 'DIRECT' },
  ];
  const referred = [
    { id: 100, refree: 'AG12' },
    { id: 101, refree: 'HOUSE10' },
    { id: 102, refree: ' EX13 ' },
    { id: 103, refree: 'ag12' }, // case differs: not an exact code, left alone
  ];

  const { agentPlayers, teamRows, refreeUsers } = selectAgentTreeReferrals({ staff, players, teams, referred });

  assert.deepEqual(agentPlayers.map((p) => p.id).sort(), [11, 12, 13, 14, 15]);
  assert.deepEqual(teamRows.map((r) => r.membername).sort(), ['m2', 'm3', 'm4', 'm5', 'm6']);
  assert.deepEqual(refreeUsers.map((u) => u.id).sort(), [100, 102]);

  // Idempotent: once removed, nothing is selected again.
  const after = selectAgentTreeReferrals({
    staff,
    players,
    teams: teams.filter((r) => !teamRows.includes(r)),
    referred: referred.filter((u) => !refreeUsers.includes(u)),
  });
  assert.equal(after.teamRows.length, 0);
  assert.equal(after.refreeUsers.length, 0);
});

test('agent-tree referral codes do not work (DB)', async (t) => {
  const logger = createLogger({ name: 'agent-tree-referral-test', level: 'silent' });

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
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const config = {
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
    JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
    SERVICE_NAME: 'user-service',
    PUBLIC_SITE_URL: 'https://play.example.test',
  };
  const auth = new AuthService({ models, db: connection, logger, mailer: { send: async () => {} }, config });
  const profile = new ProfileService({ models, db: connection, logger, config });
  const affiliate = new AffiliateService({ models, db: connection, logger, config });

  const agentIds = new Set();
  configureAgentPlayers({ isAgentPlayer: async (id) => agentIds.has(Number(id)) });

  const created = [];
  const unique = `at${process.pid}${Date.now().toString(36).slice(-4)}`;
  const signUp = async (suffix, overrides = {}) => {
    const account = await auth.register({
      username: `${unique}${suffix}`,
      password: 'correct-horse-battery',
      email: `${unique}${suffix}@test.invalid`,
      ...overrides,
    });
    created.push(Number(account.id));
    return account;
  };
  const row = (id) => models.Users.findOne({ where: { id }, raw: true });

  t.after(async () => {
    resetAgentPlayers();
    for (const id of created) {
      const user = await models.Users.findOne({ where: { id }, attributes: ['name'], raw: true });
      if (user?.name) await models.Team.destroy({ where: { membername: user.name } });
      await models.AuthSession.destroy({ where: { user_id: id } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    await connection.close();
  });

  // An agent-tree player that still holds a code from before the rule, and a direct player.
  const agentOwner = await row((await signUp('ag')).id);
  agentIds.add(Number(agentOwner.id));
  const directOwner = await row((await signUp('dir')).id);

  await t.test('signup with an agent-tree player code is 422 and creates nothing', async () => {
    for (const typed of [agentOwner.referalcode, agentOwner.referalcode.toLowerCase(), agentOwner.name]) {
      const username = `${unique}x${created.length}`;
      const err = await auth
        .register({ username, password: 'correct-horse-battery', email: `${username}@test.invalid`, referredBy: typed })
        .catch((e) => e);
      assert.equal(err.code, 'AUTH_REFERRAL_CODE_INVALID', `typed ${typed}`);
      assert.equal(err.status ?? err.statusCode, 422);
      assert.match(err.message, /does not match any player/);
      assert.equal(await models.Users.count({ where: { name: username } }), 0, 'no account');
    }
    assert.equal(await models.Team.count({ where: { ownername: agentOwner.name } }), 0, 'no team row');
  });

  await t.test('verify-referral says false for the agent-tree code, true for a direct one', async () => {
    assert.deepEqual(await profile.verifyReferralCode(agentOwner.referalcode), { valid: false });
    assert.deepEqual(await profile.verifyReferralCode(agentOwner.name), { valid: false });
    assert.deepEqual(await profile.verifyReferralCode(directOwner.referalcode), { valid: true });
  });

  await t.test('a direct player code still works at signup', async () => {
    const member = await signUp('m1', { referredBy: directOwner.referalcode });
    assert.equal((await row(member.id)).refree, directOwner.referalcode);
    const team = await models.Team.findOne({ where: { membername: member.name }, raw: true });
    assert.equal(team?.ownername, directOwner.name);
  });

  await t.test("joinTeam refuses an agent-tree owner's team", async () => {
    const loner = await signUp('m2');
    await assert.rejects(
      () => affiliate.joinTeam({ userId: loner.id, referralCode: agentOwner.referalcode }),
      (err) => err.code === 'AFFILIATE_INVALID_REFERRAL_CODE'
    );
    assert.equal(await models.Team.count({ where: { membername: loner.name } }), 0);

    // ...and the same player can join a direct owner's team.
    const joined = await affiliate.joinTeam({ userId: loner.id, referralCode: directOwner.referalcode });
    assert.equal(joined.owner, directOwner.name);
  });

  await t.test('a child member (any parent) cannot join a team, and earns its referrer nothing', async () => {
    const child = await signUp('c1');
    agentIds.add(Number(child.id));
    await assert.rejects(
      () => affiliate.joinTeam({ userId: child.id, referralCode: directOwner.referalcode }),
      (err) => err.code === 'PROMOTIONS_NOT_FOR_AGENT_USERS'
    );
    // An old team row (from before the rule) earns nothing on the child's wagering.
    await models.Team.create({ ownername: directOwner.name, membername: child.name, referalCode: directOwner.referalcode, campaign: '', createdAt: new Date(), updatedAt: new Date() });
    const out = await affiliate.onWager({ userId: child.id, previousWager: '0', newWager: '1000' });
    assert.equal(out.skipped, 'AGENT_TREE_PLAYER');
    await assert.rejects(() => affiliate.unlockFor({ memberName: child.name }), (err) => err.code === 'PROMOTIONS_NOT_FOR_AGENT_USERS');
  });
});
