'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { BranchesService } = require('../branches.service');
const v = require('../branches.validators');
const migration = require('../../../../../../packages/db/migrations/159-branches');
const { TransactionHistoryService } = require('../../../../../user/src/modules/transaction-history/transactionHistory.service');

/**
 * Branches: the owner's switch closes everything, a branch sees its own players and nobody
 * else's, its totals are the Dashboard's figures for those players, and a password change or
 * deactivation ends its session.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const config = {
  JWT_ACCESS_SECRET: 'branches-test-access',
  JWT_REFRESH_SECRET: 'branches-test-refresh',
  JWT_ADMIN_SECRET: 'branches-test-admin',
};
const tag = `t${process.pid % 100_000}`;

test('branch validators', () => {
  assert.equal(v.report.query.safeParse({ from: '2026-01-02', to: '2026-01-01' }).success, false);
  assert.equal(v.report.query.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success, false);
  assert.equal(v.report.query.safeParse({ from: '2026-01-01', to: '2026-02-01', branchId: '1' }).success, false);
  assert.equal(v.portalStatement.query.safeParse({ fromDate: '2026-01-01', toDate: '2026-01-31', category: 'NOPE' }).success, false);
  assert.equal(v.portalCreatePlayer.body.safeParse({ username: 'ok_name', password: 'longenough', parentStaffId: 1 }).success, false);
  // The player's mobile number is mandatory: digits only, 10–15.
  assert.equal(v.portalCreatePlayer.body.safeParse({ username: 'ok_name', password: 'longenough' }).success, false);
  assert.equal(v.portalCreatePlayer.body.safeParse({ username: 'ok_name', password: 'longenough', phone: '12345' }).success, false);
  assert.equal(v.portalCreatePlayer.body.safeParse({ username: 'ok_name', password: 'longenough', phone: '+91 98765' }).success, false);
  assert.equal(v.portalCreatePlayer.body.safeParse({ username: 'ok_name', password: 'longenough', phone: '9876543210' }).success, true);
  // The login looks an email up in lower case.
  assert.equal(v.portalCreatePlayer.body.parse({ username: 'ok_name', password: 'longenough', phone: '9876543210', email: 'Mixed@Example.COM' }).email, 'mixed@example.com');
  // bcrypt's limit is bytes, not characters.
  assert.equal(v.create.body.safeParse({ name: 'Branch', username: 'branch', password: 'é'.repeat(37) }).success, false);
  assert.equal(v.create.body.safeParse({ name: 'Branch', username: 'branch', password: 'a'.repeat(72) }).success, true);
  // A date Postgres would refuse is a validation error, not a 500.
  for (const fromDate of ['2026-13-45', '2026-02-31']) {
    assert.equal(v.portalStatement.query.safeParse({ fromDate, toDate: '2026-12-31' }).success, false, fromDate);
    assert.equal(v.portalBets.query.safeParse({ fromDate, toDate: '2026-12-31', kind: 'casino' }).success, false, fromDate);
  }
  assert.equal(v.portalStatement.query.safeParse({ fromDate: '2028-02-29', toDate: '2028-03-01' }).success, true);
  // A player's new password: 8–72 characters, nothing else in the body.
  assert.equal(v.playerPassword.body.safeParse({ password: 'short' }).success, false);
  assert.equal(v.playerPassword.body.safeParse({ password: 'longenough', status: 'active' }).success, false);
  assert.equal(v.playerPassword.body.safeParse({ password: 'longenough' }).success, true);
  assert.equal(v.portalPlayerPassword.params.safeParse({ userId: 'abc' }).success, false);
});

test('branches against a database', async (t) => {
  const logger = createLogger({ name: 'branches-test', level: 'silent' });
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

  const { models, sequelize } = connection;
  await migration.up({ sequelize });
  // user-service's rail list, called in-process instead of over /internal/user/history/branch.
  const history = new TransactionHistoryService({ models, logger, config: {} });
  const clients = {
    user: {
      get: async (_path, { query: { kind, from, to, ...q } }) => {
        const args = { ...q, from: new Date(from), to: new Date(to) };
        return kind === 'withdrawals' ? history.allWithdrawals(args) : history.allDeposits(args);
      },
    },
  };
  const service = new BranchesService({ models, db: connection, logger, config, clients });
  const [before] = await sequelize.query("SELECT variant FROM site_features WHERE feature = 'branch_management'", { type: 'SELECT' });
  const setSwitch = (variant) =>
    models.SiteFeature.upsert({ feature: 'branch_management', variant, enabled: true, config: {}, secrets: {}, updated_by: 'test' });

  const playerIds = [];
  t.after(async () => {
    if (playerIds.length) {
      await sequelize.query('DELETE FROM mssports.point_ledger_direct WHERE user_id IN (:ids)', { replacements: { ids: playerIds } });
      await models.FiatDeposits.destroy({ where: { user_id: playerIds.map(String) } });
      await sequelize.query('DELETE FROM mssports."SportsBet" WHERE user_id IN (:ids)', { replacements: { ids: playerIds } });
      await sequelize.query('DELETE FROM mssports.users WHERE user_id IN (:ids)', { replacements: { ids: playerIds } }).catch(() => {});
      await models.Credits.destroy({ where: { uid: playerIds } });
      await models.Users.destroy({ where: { id: playerIds } });
    }
    await sequelize.query('DELETE FROM branches WHERE username LIKE :p', { replacements: { p: `${tag}-%` } });
    if (before) await setSwitch(before.variant);
    else await sequelize.query("DELETE FROM site_features WHERE feature = 'branch_management'");
    await connection.close();
  });

  const owner = { id: 1 };
  let a;
  let b;
  const players = {};

  await t.test('switched off: no sign-in', async () => {
    await setSwitch('off');
    await assert.rejects(() => service.assertEnabled(), (e) => e.code === 'BRANCH_DISABLED');
    await assert.rejects(() => service.login({ username: 'x', password: 'y' }), (e) => e.code === 'BRANCH_DISABLED');
    await setSwitch('on');
    await service.assertEnabled();
  });

  await t.test('create branches and their players', async () => {
    a = await service.create({ actor: owner, name: 'Branch A', username: `${tag}-a`, password: 'branch-a-pass' });
    b = await service.create({ actor: owner, name: 'Branch B', username: `${tag}-b`, password: 'branch-b-pass' });
    await assert.rejects(
      () => service.create({ actor: owner, name: 'Dup', username: `${tag}-A`, password: 'whatever1' }),
      (e) => e.code === 'BRANCH_USERNAME_TAKEN'
    );
    for (const [key, branch] of [['a1', a], ['a2', a], ['b1', b]]) {
      players[key] = await service.createPlayer({ branchId: branch.id, username: `${tag}${key}`, password: 'player-pass' });
      playerIds.push(Number(players[key].id));
    }
    const [row] = await sequelize.query('SELECT parent_staff_id, branch_id, referalcode FROM users WHERE id = :id', {
      replacements: { id: players.a1.id },
      type: 'SELECT',
    });
    // A direct user (deposits and withdrawals on the site), counted in its branch.
    assert.equal(row.parent_staff_id, null);
    assert.equal(Number(row.branch_id), a.id);
    assert.ok(row.referalcode);
    await assert.rejects(
      () => service.createPlayer({ branchId: b.id, username: `${tag}A1`, password: 'player-pass' }),
      (e) => e.code === 'BRANCH_PLAYER_EXISTS'
    );
  });

  await t.test('a new player clashes as on the site sign-up', async () => {
    // Its own branch: the reports below count the players of a and b.
    const c = await service.create({ actor: owner, name: 'Branch C', username: `${tag}-c`, password: 'branch-c-pass' });
    const phone = `9${String(Date.now()).slice(-9)}`;
    const email = `${tag}Mixed@example.com`;
    const first = await service.createPlayer({ branchId: c.id, username: `${tag}Zx1`, password: 'player-pass', phone, email });
    playerIds.push(Number(first.id));
    const refused = (fields) =>
      assert.rejects(() => service.createPlayer({ branchId: b.id, password: 'player-pass', ...fields }), (e) => e.code === 'BRANCH_PLAYER_EXISTS');
    await refused({ username: `${tag}ph`, phone });
    await refused({ username: `${tag}em`, email: email.toLowerCase() });

    // `_` is an ordinary character in a name, not a LIKE wildcard.
    const underscore = await service.createPlayer({ branchId: c.id, username: `${tag}_x1`, password: 'player-pass' });
    playerIds.push(Number(underscore.id));
  });

  await t.test('a branch sees only its own players and their ledger', async () => {
    const listA = await service.players({ branchId: a.id });
    assert.deepEqual(listA.rows.map((r) => r.id).sort(), [players.a1.id, players.a2.id].sort());
    assert.equal((await service.players({ branchId: b.id })).total, 1);

    const entry = (user, ref, category, delta) =>
      sequelize.query(
        `INSERT INTO mssports.point_ledger_direct (entry_ref, event_type, category, user_id, currency, delta, created_at)
         VALUES (:ref, 'TEST', :category, :user, 'USD', :delta, '2001-05-03T10:00:00Z')`,
        { replacements: { ref: `${tag}:${ref}`, category, user, delta } }
      );
    await entry(players.a1.id, 'a1-dep', 'DEPOSIT', 100);
    await entry(players.a2.id, 'a2-bet', 'CASINO', -5);
    await entry(players.b1.id, 'b1-dep', 'DEPOSIT', 40);

    const window = { fromDate: '2001-05-01', toDate: '2001-05-31' };
    const all = await service.statement({ branchId: a.id, ...window });
    assert.equal(all.total, 2);
    assert.ok(all.rows.every((r) => [players.a1.id, players.a2.id].includes(r.user.id)));
    const deposits = await service.statement({ branchId: a.id, ...window, category: 'DEPOSIT' });
    assert.deepEqual(deposits.rows.map((r) => r.amount), ['100.00']);
    await assert.rejects(
      () => service.statement({ branchId: a.id, ...window, userId: Number(players.b1.id) }),
      (e) => e.code === 'BRANCH_PLAYER_NOT_FOUND'
    );
  });

  await t.test("totals are the Dashboard's figures for the branch's players", async () => {
    const deposit = (user, amount) => ({
      user_id: String(user), amount, currency: 'USD', status: 'approved', account_holder_name: 'Test',
      created_at: new Date('2001-05-03T10:00:00Z'),
    });
    await models.FiatDeposits.bulkCreate([deposit(players.a1.id, '100'), deposit(players.b1.id, '40')]);
    const window = { from: '2001-05-01T00:00:00Z', to: '2001-06-01T00:00:00Z' };
    const sa = await service.summary({ branchId: a.id, ...window });
    const sb = await service.summary({ branchId: b.id, ...window });
    assert.equal(sa.players, 2);
    assert.equal(sa.totals.depositCount, 1);
    assert.equal(sb.totals.depositCount, 1);
    // Converted to the site's reporting coin, whatever it is: the ratio survives.
    assert.equal(Number(sa.totals.deposits) / Number(sb.totals.deposits), 2.5);

    const report = await service.report(window);
    const mine = report.rows.filter((r) => [a.id, b.id].includes(r.branch.id));
    assert.equal(mine.length, 2);
    assert.ok(report.total.depositCount >= 2);
  });

  await t.test('deposits, bets and a player page stay inside the branch', async () => {
    await models.FiatDeposits.create({
      user_id: String(players.b1.id), amount: '7', currency: 'USD', status: 'pending', account_holder_name: 'Test',
      transaction_id: 'UTR-B1', created_at: new Date('2001-05-04T10:00:00Z'),
    });
    const window = { fromDate: '2001-05-01', toDate: '2001-05-31' };

    const depA = await service.money({ branchId: a.id, kind: 'deposits', ...window });
    assert.equal(depA.total, 1);
    assert.equal(depA.rows[0].user.id, players.a1.id);
    assert.equal(depA.rows[0].method, 'manual');
    const depB = await service.money({ branchId: b.id, kind: 'deposits', ...window, status: 'pending' });
    assert.deepEqual(depB.rows.map((r) => r.reference), ['UTR-B1']);
    assert.equal((await service.money({ branchId: a.id, kind: 'withdrawals', ...window })).total, 0);
    await assert.rejects(
      () => service.money({ branchId: a.id, kind: 'deposits', ...window, userId: Number(players.b1.id) }),
      (e) => e.code === 'BRANCH_PLAYER_NOT_FOUND'
    );

    await sequelize.query(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt") VALUES (:a, :n, 'x', 4, now(), now()) ON CONFLICT (user_id) DO NOTHING`,
      { replacements: { a: players.a2.id, n: players.a2.name } }
    );
    await sequelize.query(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, sport_id, stake_amount, original_currency, status, created_at, updated_at)
       VALUES (:a, 'MO', 'back', 2, '4', 25, 'INR', 'open', '2001-05-05T10:00:00Z', '2001-05-05T10:00:00Z')`,
      { replacements: { a: players.a2.id } }
    );
    const sportsA = await service.bets({ branchId: a.id, kind: 'sports', ...window });
    assert.equal(sportsA.total, 1);
    assert.equal(sportsA.rows[0].stake, '25.00000000');
    assert.equal((await service.bets({ branchId: b.id, kind: 'sports', ...window })).total, 0);
    // The casino unions run (no rounds in this window).
    assert.equal((await service.bets({ branchId: a.id, kind: 'originals', ...window })).total, 0);
    assert.equal((await service.bets({ branchId: a.id, kind: 'casino', ...window })).total, 0);

    assert.equal((await service.player({ branchId: a.id, userId: players.a1.id })).name, players.a1.name);
    await assert.rejects(() => service.player({ branchId: b.id, userId: players.a1.id }), (e) => e.code === 'BRANCH_PLAYER_NOT_FOUND');
  });

  await t.test("a player's password: only the own branch changes it, and it ends the player's sessions", async () => {
    const { verifyPassword } = require('@ibitplay/auth');
    const userId = players.a1.id;
    await assert.rejects(
      () => service.setPlayerPassword({ branchId: b.id, userId, password: 'stolen-pass' }),
      (e) => e.code === 'BRANCH_PLAYER_NOT_FOUND'
    );
    const result = await service.setPlayerPassword({ branchId: a.id, userId, password: 'player-new-pass' });
    assert.equal(result.passwordChanged, true);
    const row = await models.Users.findByPk(userId, { attributes: ['password', 'password2'], raw: true });
    assert.equal(await verifyPassword('player-new-pass', row.password), true);
    assert.equal(await verifyPassword('player-pass', row.password), false);
    assert.equal(row.password2, null);
  });

  await t.test('sign-in, and what ends a session', async () => {
    await assert.rejects(() => service.login({ username: `${tag}-a`, password: 'wrong-pass' }), (e) => e.code === 'BRANCH_INVALID_CREDENTIALS');
    await assert.rejects(() => service.login({ username: `${tag}-nobody`, password: 'wrong-pass' }), (e) => e.code === 'BRANCH_INVALID_CREDENTIALS');

    const { token } = await service.login({ username: `${tag}-A`, password: 'branch-a-pass' });
    assert.equal((await service.authenticate(token)).id, a.id);
    // A staff-shaped token, or garbage, is not a branch session.
    await assert.rejects(() => service.authenticate('nope'), (e) => e.code === 'BRANCH_UNAUTHENTICATED');

    await service.setPassword({ branchId: a.id, password: 'branch-a-new' });
    await assert.rejects(() => service.authenticate(token), (e) => e.code === 'BRANCH_UNAUTHENTICATED');

    const fresh = (await service.login({ username: `${tag}-a`, password: 'branch-a-new' })).token;
    await service.update({ branchId: a.id, status: 'inactive' });
    await assert.rejects(
      () => service.createPlayer({ branchId: a.id, username: `${tag}late`, password: 'player-pass' }),
      (e) => e.code === 'BRANCH_INACTIVE_NO_NEW_PLAYERS'
    );
    await assert.rejects(() => service.authenticate(fresh), (e) => e.code === 'BRANCH_UNAUTHENTICATED');
    await assert.rejects(() => service.login({ username: `${tag}-a`, password: 'branch-a-new' }), (e) => e.code === 'BRANCH_INACTIVE');

    await service.update({ branchId: a.id, status: 'active' });
    const again = (await service.login({ username: `${tag}-a`, password: 'branch-a-new' })).token;
    await service.logout(a.id);
    await assert.rejects(() => service.authenticate(again), (e) => e.code === 'BRANCH_UNAUTHENTICATED');
  });
});
