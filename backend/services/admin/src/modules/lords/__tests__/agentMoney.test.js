'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { LordsService } = require('../lords.service');
const { StatementsService } = require('../../statements/statements.service');
const { StaffService } = require('../../staff/staff.service');
const txn = require('../../staff-auth/transactionPassword');

/**
 * Agent-tree money (B2B fixes 1, 2, 3, 5).
 *
 *   - an agent-tree "adjust balance" is a TRANSFER from the agent's own float,
 *     never new money; it refuses with 422 INSUFFICIENT_FUNDS, needs the
 *     transaction password, and lands on both statements
 *   - two simultaneous credits cannot overdraw the float
 *   - the credit limit is stored (player and staff) and the staff one lets a
 *     float fund players down to −credit_limit
 *   - the transaction password can be set, is hashed, and is checked
 *   - refills carry their own transfer type and statement label
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextStaffId = 980_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);

let nextUid = 830_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const LOGIN_PASSWORD = 'agent login password';
const TXN_PASSWORD = 'agent transaction password';

test('agent-tree money', async (t) => {
  const logger = createLogger({ name: 'agent-money-test', level: 'silent' });

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const { models } = connection;
  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'admin-service', ADMIN_MAX_REFILL: '1000000' } };
  const lords = new LordsService(deps);
  const statements = new StatementsService(deps);
  const staffService = new StaffService(deps);

  const roleId = 9900 + (process.pid % 40);

  const seedStaff = async (id, { inr = '0', creditLimit = '0', parentId = null, withTxn = true } = {}) => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:roleId, :name, 6) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level`,
      { replacements: { roleId, name: `agent-money-role-${roleId}` } }
    );
    const { Op } = require('sequelize');
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: id }, { descendant_id: id }] } });
    await models.StaffCredits.destroy({ where: { staff_id: id } });
    await models.Staff.destroy({ where: { id } });

    await models.Staff.create({
      id,
      name: `agent-money-${id}`,
      email: `agent-money-${id}@test.invalid`,
      password: await hashPassword(LOGIN_PASSWORD, 4),
      transaction_password: withTxn ? await hashPassword(TXN_PASSWORD, 4) : null,
      role_id: roleId,
      parent_id: parentId,
      status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, inr, credit_limit: creditLimit });

    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  const seedPlayer = async (uid, staffId, inr = '0') => {
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.WalletHistory.destroy({ where: { uid } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `agent-money-player-${uid}`, password: 'x', status: 'active', parent_staff_id: staffId });
    await models.Credits.create({ uid, inr });
    return uid;
  };

  const playerBalance = async (uid) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinorQuantised(row?.inr ?? '0'));
  };
  const floatOf = async (id) => {
    const row = await models.StaffCredits.findOne({ where: { staff_id: id }, raw: true });
    return money.toDecimalString(money.toMinorQuantised(row?.inr ?? '0'));
  };

  let keySeq = 0;
  const adjust = (staff, userId, operation, amount, extra = {}) =>
    lords.adjustPlayer({
      actor: { id: staff },
      userId,
      currency: 'INR',
      amount,
      operation,
      description: `test ${operation}`,
      idempotencyKey: `agent-money-test:${process.pid}:${(keySeq += 1)}`,
      transactionPassword: TXN_PASSWORD,
      ...extra,
    });

  // ══════════════════════════════════════════════════════════════════════
  //  Fix 1 — adjust is a transfer
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a credit moves money from the agent float to the player', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '1000' });
    const player = await seedPlayer(newUid(), agent, '0');

    const result = await adjust(agent, player, 'credit', '300');

    assert.equal(result.replayed, false);
    assert.equal(result.newBalance, '300.00000000');
    assert.equal(result.staffBalance.balance, '700.00000000');
    assert.equal(await playerBalance(player), '300.00000000');
    assert.equal(await floatOf(agent), '700.00000000');

    const transfer = await models.StaffTransfers.findByPk(result.transferId, { raw: true });
    assert.equal(transfer.transfer_type, 'adjust');
    assert.equal(transfer.from_type, 'staff');
    assert.equal(String(transfer.from_id), String(agent));
    assert.equal(transfer.to_type, 'user');

    const ledger = await models.CreditsLedger.findByPk(result.ledgerId, { raw: true });
    assert.equal(ledger.reason, 'TRANSFER_IN');
    assert.equal(money.toDecimalString(money.toMinorQuantised(ledger.amount)), '300.00000000');

    const history = await models.WalletHistory.findAll({ where: { uid: player }, raw: true });
    assert.equal(history.length, 1);
    assert.equal(history[0].operation, 'credit');
  });

  await t.test('a debit moves money from the player back to the agent float', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '0' });
    const player = await seedPlayer(newUid(), agent, '500');

    const result = await adjust(agent, player, 'debit', '200');

    assert.equal(await playerBalance(player), '300.00000000');
    assert.equal(await floatOf(agent), '200.00000000');
    const transfer = await models.StaffTransfers.findByPk(result.transferId, { raw: true });
    assert.equal(transfer.from_type, 'user');
    assert.equal(transfer.to_type, 'staff');
    assert.equal(transfer.direction, 'withdraw');
  });

  await t.test('a debit larger than the player balance moves nothing', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '0' });
    const player = await seedPlayer(newUid(), agent, '50');

    await assert.rejects(() => adjust(agent, player, 'debit', '80'), (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422 && err.details?.party === 'user');
    assert.equal(await playerBalance(player), '50.00000000');
    assert.equal(await floatOf(agent), '0.00000000');
  });

  await t.test('a credit beyond the float is a 422 INSUFFICIENT_FUNDS and moves nothing', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '100' });
    const player = await seedPlayer(newUid(), agent, '0');

    await assert.rejects(
      () => adjust(agent, player, 'credit', '150'),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422 && err.details?.party === 'staff'
    );
    assert.equal(await playerBalance(player), '0.00000000');
    assert.equal(await floatOf(agent), '100.00000000');
    assert.equal(await models.StaffTransfers.count({ where: { to_type: 'user', to_id: player } }), 0);
  });

  await t.test('two simultaneous credits cannot overdraw the float', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '100' });
    const a = await seedPlayer(newUid(), agent, '0');
    const b = await seedPlayer(newUid(), agent, '0');

    const results = await Promise.allSettled([
      adjust(agent, a, 'credit', '60'),
      adjust(agent, b, 'credit', '60'),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const refused = results.find((r) => r.status === 'rejected');
    assert.equal(refused.reason.code, 'INSUFFICIENT_FUNDS');
    assert.equal(await floatOf(agent), '40.00000000', 'exactly one debit, never negative');
    const total = money.toMinor(await playerBalance(a)) + money.toMinor(await playerBalance(b));
    assert.equal(money.toDecimalString(total), '60.00000000', 'money is conserved');
  });

  await t.test('a replayed key moves nothing a second time', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const player = await seedPlayer(newUid(), agent, '0');
    const key = `agent-money-replay:${process.pid}:${player}`;

    const first = await adjust(agent, player, 'credit', '100', { idempotencyKey: key });
    const second = await adjust(agent, player, 'credit', '100', { idempotencyKey: key });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(await floatOf(agent), '400.00000000');
    assert.equal(await playerBalance(player), '100.00000000');
  });

  await t.test('the transaction password is required, and must be set', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const player = await seedPlayer(newUid(), agent, '0');

    await assert.rejects(
      () => adjust(agent, player, 'credit', '10', { transactionPassword: 'wrong' }),
      (err) => err.code === 'TXN_PASSWORD_INVALID' && err.status === 403
    );
    await assert.rejects(
      () => adjust(agent, player, 'credit', '10', { transactionPassword: undefined }),
      (err) => err.code === 'TXN_PASSWORD_REQUIRED'
    );

    const unset = await seedStaff(newStaffId(), { inr: '500', withTxn: false });
    const theirs = await seedPlayer(newUid(), unset, '0');
    await assert.rejects(() => adjust(unset, theirs, 'credit', '10'), (err) => err.code === 'TXN_PASSWORD_NOT_SET');

    assert.equal(await floatOf(agent), '500.00000000');
    assert.equal(await floatOf(unset), '500.00000000');
  });

  await t.test('a player outside the tree, or a non-INR currency, is refused', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const other = await seedStaff(newStaffId(), { inr: '0' });
    const theirs = await seedPlayer(newUid(), other, '0');
    const mine = await seedPlayer(newUid(), agent, '0');

    await assert.rejects(() => adjust(agent, theirs, 'credit', '10'), (err) => err.code === 'ACCOUNTS_NOT_IN_YOUR_TREE');
    await assert.rejects(
      () => adjust(agent, mine, 'credit', '10', { currency: 'USDT' }),
      (err) => err.code === 'ACCOUNTS_FLOAT_CURRENCY_ONLY'
    );
    assert.equal(await floatOf(agent), '500.00000000');
  });

  await t.test('out of tree is 404 whatever the password: tree scope runs before the password check', async () => {
    // The password used to be checked first, so a probe at another tree's
    // player learned "wrong password" (403) versus "not yours" (404) and spent
    // a password attempt doing it. Now every variant is the same 404.
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const other = await seedStaff(newStaffId(), { inr: '0' });
    const theirs = await seedPlayer(newUid(), other, '0');
    const notInTree = (err) => err.code === 'ACCOUNTS_NOT_IN_YOUR_TREE' && err.status === 404;

    for (const transactionPassword of [TXN_PASSWORD, 'wrong', undefined]) {
      await assert.rejects(() => adjust(agent, theirs, 'credit', '10', { transactionPassword }), notInTree);
    }
    // The same for the other password-guarded lords actions.
    for (const transactionPassword of ['wrong', undefined]) {
      await assert.rejects(() => lords.refill({ actor: { id: agent }, accountId: theirs, amount: '1', transactionPassword }), notInTree);
      await assert.rejects(
        () => lords.setExposureLimit({ actor: { id: agent }, accountType: 'user', accountId: theirs, exposureLimit: '1', transactionPassword }),
        notInTree
      );
      await assert.rejects(
        () => lords.setPassword({ actor: { id: agent }, accountType: 'user', accountId: theirs, newPassword: 'a brand new long password', transactionPassword }),
        notInTree
      );
    }
    // An agent with no transaction password at all still gets 404, not NOT_SET.
    const unset = await seedStaff(newStaffId(), { inr: '500', withTxn: false });
    await assert.rejects(() => adjust(unset, theirs, 'credit', '10'), notInTree);

    assert.equal(await floatOf(agent), '500.00000000');
  });

  await t.test('the adjustment is on both statements, labelled', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '1000' });
    const player = await seedPlayer(newUid(), agent, '0');
    await adjust(agent, player, 'credit', '250');

    const playerSide = await statements.userStatement({ staff: { id: agent }, userId: player });
    const inRow = playerSide.rows.find((r) => r.label === 'Balance credited by agent');
    assert.ok(inRow, 'player statement shows the adjustment');
    assert.equal(inRow.amount, '250.00000000');
    assert.equal(playerSide.balance.depositIn, '250.00000000');
    assert.equal(playerSide.balance.unexplained, '0.00000000');

    const agentSide = await statements.agentStatement({ staff: { id: agent }, staffId: agent });
    const outRow = agentSide.rows.find((r) => r.label === 'Balance credit to player');
    assert.ok(outRow, 'agent statement shows the adjustment');
    assert.equal(outRow.amount, '-250.00000000');
    assert.equal(outRow.legacy, null);
  });

  await t.test('a house adjustment (ADMIN_CREDIT ledger row) is on the player statement', async () => {
    const house = await seedStaff(newStaffId(), { inr: '0' });
    const player = await seedPlayer(newUid(), house, '75');
    await models.CreditsLedger.create({
      user_id: String(player), currency: 'INR', amount: '75', reason: 'ADMIN_CREDIT', description: 'goodwill',
      balance: '75', closing: '75', netamount: 0, profit: 0, loss: 0, commission: 0,
      meta: { refType: 'STAFF', refId: String(house), previousBalance: '0' },
    });

    const statement = await statements.userStatement({ staff: { id: house }, userId: player });
    const row = statement.rows.find((r) => r.label === 'Balance adjustment (credit)');
    assert.ok(row);
    assert.equal(row.party, `agent-money-${house}`);
    assert.equal(statement.balance.lifetimeUnreconciled, '0.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Fix 2 — credit limit
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a player can never be given a credit limit — 422, nothing stored', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '0' });
    const player = await seedPlayer(newUid(), agent, '0');
    const refused = (err) => err.code === 'ACCOUNTS_PLAYER_CREDIT_NOT_SUPPORTED' && err.status === 422;

    // Explicit 'user', and the default when accountType is left out.
    await assert.rejects(
      () => lords.setCreditLimit({ actor: { id: agent }, accountType: 'user', accountId: player, creditLimit: '500', transactionPassword: TXN_PASSWORD }),
      refused
    );
    await assert.rejects(
      () => lords.setCreditLimit({ actor: { id: agent }, accountId: player, creditLimit: '500', transactionPassword: TXN_PASSWORD }),
      refused
    );

    const row = await models.Credits.findOne({ where: { uid: player }, raw: true });
    assert.equal(money.toDecimalString(money.toMinorQuantised(row?.credit_limit ?? '0')), '0.00000000');

    // Even a stale stored value is never reported for a player.
    await models.Credits.update({ credit_limit: '500' }, { where: { uid: player } });
    const page = await lords.allDetails({ actor: { id: agent } });
    assert.equal(page.rows.find((r) => r.id === Number(player)).credit_limit, 0);
  });

  await t.test('migration 068 zeroes player credit limits and nulls password2', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '0' });
    const player = await seedPlayer(newUid(), agent, '0');
    await models.Credits.update({ credit_limit: '500' }, { where: { uid: player } });
    await models.Users.update({ password2: '' }, { where: { id: player } });
    await models.Staff.update({ password2: '' }, { where: { id: agent } });
    await models.StaffCredits.update({ credit_limit: '300' }, { where: { staff_id: agent } });

    const migration = require('../../../../../../packages/db/migrations/068-no-plaintext-passwords-no-player-credit');
    await connection.sequelize.transaction((transaction) => migration.up({ sequelize: connection.sequelize, transaction }));

    const credit = await models.Credits.findOne({ where: { uid: player }, raw: true });
    assert.equal(money.toDecimalString(money.toMinorQuantised(credit.credit_limit)), '0.00000000');
    assert.equal((await models.Users.findByPk(player, { raw: true })).password2, null);
    assert.equal((await models.Staff.findByPk(agent, { raw: true })).password2, null);
    // An agent's credit line is a different thing and is left alone.
    const bal = await models.StaffCredits.findOne({ where: { staff_id: agent }, raw: true });
    assert.equal(money.toDecimalString(money.toMinorQuantised(bal.credit_limit)), '300.00000000');
  });

  await t.test('an agent credit line lets the float fund players below zero, and no further', async () => {
    const master = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { inr: '100', parentId: master });
    const player = await seedPlayer(newUid(), agent, '0');

    await lords.setCreditLimit({
      actor: { id: master }, accountType: 'staff', accountId: agent, creditLimit: '200', transactionPassword: TXN_PASSWORD,
    });

    await adjust(agent, player, 'credit', '250');
    assert.equal(await floatOf(agent), '-150.00000000');

    await assert.rejects(() => adjust(agent, player, 'credit', '100'), (err) => err.code === 'INSUFFICIENT_FUNDS');
    await adjust(agent, player, 'credit', '50');
    assert.equal(await floatOf(agent), '-200.00000000');

    // A refill draws on the same line — and the line is exhausted.
    await assert.rejects(
      () => lords.refill({ actor: { id: agent, canIssueFunds: false }, accountId: player, amount: '1', transactionPassword: TXN_PASSWORD }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );

    const float = await lords.myFloat({ actor: { id: agent } });
    assert.deepEqual(float, {
      staffId: agent, currency: 'INR', balance: '-200.00000000', creditLimit: '200.00000000', available: '0.00000000',
    });
  });

  await t.test('an agent funds its own player through the staff transfer (credit line allowed); to staff never uses the credit line', async () => {
    const master = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { inr: '0', creditLimit: '100', parentId: master });
    const sub = await seedStaff(newStaffId(), { inr: '0', parentId: agent });
    const player = await seedPlayer(newUid(), agent, '0');
    const actor = { id: agent, level: 5, canIssueFunds: false, canAdjustWallets: true, canCredit: true, canDebit: true };

    // TENEXCH: its DIRECT child player is a target of the same API; agent → player may use the
    // credit line. Withdrawn back so the float is 0 again.
    await staffService.transfer({ actor, toType: 'user', toId: player, amount: '60', direction: 'deposit', transactionPassword: TXN_PASSWORD });
    await staffService.transfer({ actor, toType: 'user', toId: player, amount: '60', direction: 'withdraw', transactionPassword: TXN_PASSWORD });
    await assert.rejects(
      () => staffService.transfer({ actor, toType: 'staff', toId: sub, amount: '10', direction: 'deposit', transactionPassword: TXN_PASSWORD }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );
    assert.equal(await floatOf(agent), '0.00000000');
  });

  await t.test('player money moves are the DIRECT parent\'s only: a master cannot credit or debit its agent\'s player', async () => {
    const master = await seedStaff(newStaffId(), { inr: '1000' });
    const agent = await seedStaff(newStaffId(), { inr: '0', parentId: master });
    const grandchildPlayer = await seedPlayer(newUid(), agent, '100');
    const ownPlayer = await seedPlayer(newUid(), master, '0');
    const notFound = (err) => err.code === 'ACCOUNTS_NOT_IN_YOUR_TREE' && err.status === 404;

    await assert.rejects(() => adjust(master, grandchildPlayer, 'credit', '10'), notFound);
    await assert.rejects(() => adjust(master, grandchildPlayer, 'debit', '10'), notFound);
    await assert.rejects(
      () => lords.refill({ actor: { id: master, canIssueFunds: false }, accountId: grandchildPlayer, amount: '10', transactionPassword: TXN_PASSWORD }),
      notFound
    );
    // Out-of-scope is decided before the password: a wrong one still reads 404.
    await assert.rejects(() => adjust(master, grandchildPlayer, 'credit', '10', { transactionPassword: 'wrong' }), notFound);
    assert.equal(await playerBalance(grandchildPlayer), '100.00000000');
    assert.equal(await floatOf(master), '1000.00000000');

    // Its own direct player works.
    await adjust(master, ownPlayer, 'credit', '10');
    assert.equal(await playerBalance(ownPlayer), '10.00000000');
    assert.equal(await floatOf(master), '990.00000000');

    // The platform owner is exempt (refill issues funds to any player in scope).
    await lords.refill({ actor: { id: master, level: 1, canIssueFunds: true }, accountId: grandchildPlayer, amount: '5', transactionPassword: TXN_PASSWORD });
    assert.equal(await playerBalance(grandchildPlayer), '105.00000000');
  });

  await t.test('password, exposure and credit settings act only strictly BELOW the caller', async () => {
    const master = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { inr: '0', parentId: master });
    const actor = { id: agent };
    const self = { accountType: 'staff', accountId: agent, transactionPassword: TXN_PASSWORD };
    const refusedSelf = (err) => err.code === 'ACCOUNTS_CANNOT_ACT_ON_SELF';

    await assert.rejects(() => lords.setPassword({ actor, ...self, newPassword: 'a brand new long password' }), refusedSelf);
    await assert.rejects(() => lords.setExposureLimit({ actor, ...self, exposureLimit: '999999' }), refusedSelf);
    await assert.rejects(() => lords.setCreditLimit({ actor, ...self, creditLimit: '999999' }), refusedSelf);

    const row = await models.Staff.findByPk(agent, { raw: true });
    assert.ok(await require('@ibitplay/auth').verifyPassword(LOGIN_PASSWORD, row.password), 'own password untouched');
    const bal = await models.StaffCredits.findOne({ where: { staff_id: agent }, raw: true });
    assert.equal(money.toDecimalString(money.toMinorQuantised(bal.exposure_limit ?? '0')), '0.00000000');
    assert.equal(money.toDecimalString(money.toMinorQuantised(bal.credit_limit ?? '0')), '0.00000000');

    // Upwards is out of the tree entirely.
    await assert.rejects(
      () => lords.setExposureLimit({ actor, accountType: 'staff', accountId: master, exposureLimit: '1', transactionPassword: TXN_PASSWORD }),
      (err) => err.code === 'ACCOUNTS_NOT_IN_YOUR_TREE'
    );

    // Below still works: a player, and a sub-agent.
    const sub = await seedStaff(newStaffId(), { inr: '0', parentId: agent });
    const player = await seedPlayer(newUid(), agent, '0');
    await lords.setExposureLimit({ actor, accountType: 'user', accountId: player, exposureLimit: '500', transactionPassword: TXN_PASSWORD });
    await lords.setExposureLimit({ actor, accountType: 'staff', accountId: sub, exposureLimit: '500', transactionPassword: TXN_PASSWORD });
    await lords.setPassword({ actor, accountType: 'staff', accountId: sub, newPassword: 'a brand new long password', transactionPassword: TXN_PASSWORD });
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Fix 3 — transaction password
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the transaction password is set with the login password, and stored hashed', async () => {
    const agent = await seedStaff(newStaffId(), { withTxn: false });

    await assert.rejects(
      () => txn.setTransactionPassword(models, { staffId: agent, currentPassword: 'nope', transactionPassword: 'second secret' }),
      (err) => err.code === 'TXN_PASSWORD_LOGIN_PASSWORD_WRONG'
    );
    await assert.rejects(
      () => txn.setTransactionPassword(models, { staffId: agent, currentPassword: LOGIN_PASSWORD, transactionPassword: LOGIN_PASSWORD }),
      (err) => err.code === 'TXN_PASSWORD_SAME_AS_LOGIN'
    );
    await assert.rejects(
      () => txn.setTransactionPassword(models, { staffId: agent, executiveId: 7, currentPassword: LOGIN_PASSWORD, transactionPassword: 'second secret' }),
      (err) => err.code === 'TXN_PASSWORD_EXECUTIVE_CANNOT_SET'
    );

    const result = await txn.setTransactionPassword(models, {
      staffId: agent, currentPassword: LOGIN_PASSWORD, transactionPassword: 'second secret',
    });
    assert.equal(result.set, true);
    assert.equal(result.changed, false);

    const row = await models.Staff.findByPk(agent, { raw: true });
    assert.match(row.transaction_password, /^\$2[aby]\$/);
    assert.notEqual(row.transaction_password, 'second secret');

    assert.deepEqual(await txn.assertTransactionPassword(models, agent, 'second secret'), { set: true, verified: true });
    await assert.rejects(() => txn.assertTransactionPassword(models, agent, 'wrong'), (err) => err.code === 'TXN_PASSWORD_INVALID');
  });

  await t.test('required:false lets an account without one through, and enforces one once set', async () => {
    const house = await seedStaff(newStaffId(), { withTxn: false });
    assert.deepEqual(await txn.assertTransactionPassword(models, house, undefined, { required: false }), { set: false, verified: false });

    const withOne = await seedStaff(newStaffId());
    await assert.rejects(
      () => txn.assertTransactionPassword(models, withOne, undefined, { required: false }),
      (err) => err.code === 'TXN_PASSWORD_REQUIRED'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Fix 5 — refills have their own type
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a refill is stored as "refill" and labelled as one; old "transfer" rows still read', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '1000' });
    const player = await seedPlayer(newUid(), agent, '0');

    await lords.refill({ actor: { id: agent, canIssueFunds: false }, accountId: player, amount: '100', transactionPassword: TXN_PASSWORD });
    // A pre-change refill, stored as a plain transfer.
    await models.StaffTransfers.create({
      from_type: 'staff', from_id: agent, to_type: 'user', to_id: player, amount: '20',
      direction: 'deposit', transfer_type: 'transfer', created_at: new Date(),
    });
    await models.Credits.increment({ inr: '20' }, { where: { uid: player } });
    await models.StaffCredits.decrement({ inr: '20' }, { where: { staff_id: agent } });

    const row = await models.StaffTransfers.findOne({ where: { to_type: 'user', to_id: player }, order: [['id', 'ASC']], raw: true });
    assert.equal(row.transfer_type, 'refill');

    const playerSide = await statements.userStatement({ staff: { id: agent }, userId: player });
    assert.ok(playerSide.rows.find((r) => r.label === 'Refill from agent' && r.amount === '100.00000000'));
    assert.ok(playerSide.rows.find((r) => r.label === 'Deposit from agent' && r.amount === '20.00000000'));
    assert.equal(playerSide.balance.depositIn, '120.00000000');

    const agentSide = await statements.agentStatement({ staff: { id: agent }, staffId: agent });
    const refillRow = agentSide.rows.find((r) => r.label === 'Refill to player');
    assert.ok(refillRow);
    assert.equal(refillRow.legacy, null, 'a refill is not a legacy settlement row');
    assert.equal(agentSide.balance.givenPlayers, '120.00000000');
  });
});
