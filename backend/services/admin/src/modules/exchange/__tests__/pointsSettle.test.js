'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { ExchangeService } = require('../exchange.service');

/**
 * Points settlement + account list — zip (msadmin) ka `settlePointsFromChild` aur `users/all-details`.
 *
 *   Client(P/L) = all_point − credit
 *   D (points > 0): parent deta hai, W (points < 0): parent leta hai
 *   sirf direct child, sirf P/L tak, galat sign refuse
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TXN_PASSWORD = 'settle transaction password';

let connection;
let nextStaffId = 975_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);
let nextUid = 830_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('points settlement and the account list', async (t) => {
  const logger = createLogger({ name: 'points-settle-test', level: 'silent' });

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
  const sql = (query, replacements) => connection.sequelize.query(query, { replacements, type: 'SELECT' });
  const exchange = new ExchangeService({ models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' } });

  const ownerRole = 8100 + (process.pid % 40); // 8xxx: sirf exchange tests (purane tests 9xxx use karte hain)
  const agentRole = 8150 + (process.pid % 40);
  for (const [id, level] of [[ownerRole, 1], [agentRole, 6]]) {
    await connection.sequelize.query(
      'INSERT INTO roles (id, name, level) VALUES (:id, :name, :level) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level',
      { replacements: { id, name: `settle-role-${id}`, level } }
    );
  }

  const seedStaff = async (id, { inr = '0', parentId = null, owner = false } = {}) => {
    await models.StaffCredits.destroy({ where: { staff_id: id } });
    // Ids pid se bante hain — pichhle run ke child staff / players is id ke neeche reh sakte hain.
    await models.Staff.update({ parent_id: null }, { where: { parent_id: id } });
    await models.Users.update({ parent_staff_id: null }, { where: { parent_staff_id: id } });
    await models.Staff.destroy({ where: { id } });
    await models.Staff.create({
      id,
      name: `settle-staff-${id}`,
      email: `settle-staff-${id}@test.invalid`,
      password: await hashPassword('login password', 4),
      transaction_password: await hashPassword(TXN_PASSWORD, 4),
      role_id: owner ? ownerRole : agentRole,
      parent_id: parentId,
      status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, user_type: owner ? 'OWNER' : 'STAFF', inr });

    // Tree (staff_hierarchy) — drill-down ka scope isi se.
    const { Op } = require('sequelize');
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: id }, { descendant_id: id }] } });
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  // Player jiska bet P/L already all_point me hai (roll-up jaisa): ledger entry bhi, taaki match rahe.
  const seedPlayer = async (uid, parentStaffId, { inr = '0', credit = '0', pl = 0 } = {}) => {
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `settle-player-${uid}`, password: 'x', status: 'active', parent_staff_id: parentStaffId });
    const allPoint = Number(credit) + pl;
    await models.Credits.create({ uid, inr, credit, all_point: allPoint });
    const wallet = await models.Credits.findOne({ where: { uid }, raw: true });
    await connection.sequelize.query('DELETE FROM mssports.point_ledger WHERE wallet_id = :id', { replacements: { id: wallet.id } });
    if (allPoint !== 0) {
      await connection.sequelize.query(
        `INSERT INTO mssports.point_ledger (entry_ref, event_type, username, wallet_id, delta, all_point_after, created_at)
         VALUES (:ref, 'BET_SETTLEMENT', 'p', :id, :delta, :delta, NOW())`,
        { replacements: { ref: `test:${uid}`, id: wallet.id, delta: allPoint } }
      );
    }
    return uid;
  };

  const dec = (v) => Number(money.fromStored(v ?? '0'));
  const playerWallet = (uid) => models.Credits.findOne({ where: { uid }, raw: true });
  const staffWallet = (id) => models.StaffCredits.findOne({ where: { staff_id: id }, raw: true });
  const ownerActor = (id) => ({ id, level: 1, canIssueFunds: true, permissions: ['*'] });
  const agentActor = (id) => ({ id, level: 6, canIssueFunds: false, permissions: ['wallet:credit', 'wallet:debit'] });
  const settle = (actor, accountId, points, accountType = 'user') =>
    exchange.settle({ actor, accountType, accountId, points, transactionPassword: TXN_PASSWORD });

  await t.test('player won 100: W -100 takes it back to the agent, P/L becomes 0', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const player = await seedPlayer(newUid(), agent, { inr: '1100', credit: '1000', pl: 100 });

    const result = await settle(agentActor(agent), player, -100);

    assert.equal(result.pendingAfter, '0.00');
    const w = await playerWallet(player);
    assert.equal(dec(w.inr), 1000);
    assert.equal(dec(w.all_point), 1000);
    assert.equal(dec(w.credit), 1000, 'credit does not move');
    assert.equal(dec((await staffWallet(agent)).inr), 600);

    const [entry] = await sql('SELECT * FROM mssports.point_ledger WHERE wallet_id = :id ORDER BY id DESC LIMIT 1', { id: w.id });
    assert.equal(entry.event_type, 'Bank Withdraw');
    assert.equal(entry.entry_ref, `cashsettle:${result.transferId}`);
    const transfer = await models.StaffTransfers.findByPk(result.transferId, { raw: true });
    assert.equal(transfer.transfer_type, 'points_settle');
  });

  await t.test('player lost 100: D +60 is paid by the agent (part of the P/L is fine)', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const player = await seedPlayer(newUid(), agent, { inr: '900', credit: '1000', pl: -100 });

    const result = await settle(agentActor(agent), player, 60);

    assert.equal(result.pendingAfter, '-40.00');
    assert.equal(dec((await playerWallet(player)).inr), 960);
    assert.equal(dec((await staffWallet(agent)).inr), 440);
  });

  await t.test('credit history lists the "Bank Deposite" entries with who gave it', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const player = await seedPlayer(newUid(), agent, { inr: '900', credit: '1000', pl: -100 });
    await settle(agentActor(agent), player, 100);

    const history = await exchange.creditHistory({ actor: agentActor(agent), accountType: 'user', accountId: player, limit: 10, offset: 0 });
    assert.equal(history.total, 1);
    assert.equal(Number(history.rows[0].amount), 100);
    assert.equal(history.rows[0].superUser, `settle-staff-${agent}`);
    assert.equal(history.rows[0].user, `settle-player-${player}`);
  });

  await t.test('wrong side, more than the P/L, or no P/L is refused', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const won = await seedPlayer(newUid(), agent, { inr: '1100', credit: '1000', pl: 100 });
    const even = await seedPlayer(newUid(), agent, { inr: '1000', credit: '1000', pl: 0 });

    await assert.rejects(() => settle(agentActor(agent), won, 50), /Amount Greater than P\/L/);
    await assert.rejects(() => settle(agentActor(agent), won, -150), /Amount Greater than P\/L/);
    await assert.rejects(() => settle(agentActor(agent), even, -10), /no pending settlement/);
    assert.equal(dec((await playerWallet(won)).inr), 1100, 'nothing moved');
  });

  await t.test('only a direct child can be settled', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '500' });
    const agent = await seedStaff(newStaffId(), { parentId: owner, inr: '500' });
    const player = await seedPlayer(newUid(), agent, { inr: '1100', credit: '1000', pl: 100 });

    await assert.rejects(() => settle(ownerActor(owner), player, -100), /not your direct child/);
  });

  await t.test('owner and a DIRECT user: paid from the Direct User balance, the credits wallet does not move', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '0' });
    const directBalance = async () => dec((await models.StaffBalances.findOne({ where: { staff_id: owner }, raw: true }))?.inr);
    const lost = await seedPlayer(newUid(), null, { inr: '700', credit: '1000', pl: -300 });
    const won = await seedPlayer(newUid(), null, { inr: '1100', credit: '1000', pl: 100 });

    // Direct User balance kam hai → refuse, kuch nahi badla.
    await models.StaffBalances.destroy({ where: { staff_id: owner } });
    await models.StaffBalances.create({ staff_id: owner, inr: '100' });
    await assert.rejects(() => settle(ownerActor(owner), lost, 300), /Direct User balance/);
    assert.equal(dec((await playerWallet(lost)).inr), 700, 'nothing moved');

    await models.StaffBalances.update({ inr: '500' }, { where: { staff_id: owner } });
    const paid = await settle(ownerActor(owner), lost, 300);
    assert.equal(dec((await playerWallet(lost)).inr), 1000);
    assert.equal(await directBalance(), 200, 'Direct User balance paid');
    assert.equal(Number(paid.parentBalance), 200);

    // Direct user jeeta → W −100: paisa Direct User balance me wapas.
    await settle(ownerActor(owner), won, -100);
    assert.equal(dec((await playerWallet(won)).inr), 1000);
    assert.equal(await directBalance(), 300);

    const ownerRow = await staffWallet(owner);
    assert.equal(dec(ownerRow.inr), 0, 'credits wallet not charged');
    assert.equal(dec(ownerRow.down_point), 0, 'credits points not touched');
  });

  await t.test('a ledger mismatch blocks the settlement', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const player = await seedPlayer(newUid(), agent, { inr: '1100', credit: '1000', pl: 100 });
    await models.Credits.update({ all_point: '1200' }, { where: { uid: player } });

    await assert.rejects(() => settle(agentActor(agent), player, -100), /does not match ledger/);
  });

  await t.test('the account list shows direct children with CR, pts and Client(P/L)', async () => {
    const agent = await seedStaff(newStaffId(), { inr: '500' });
    const sub = await seedStaff(newStaffId(), { parentId: agent, inr: '50' });
    const player = await seedPlayer(newUid(), agent, { inr: '1100', credit: '1000', pl: 100 });
    await seedPlayer(newUid(), sub, { inr: '10' }); // grandchild — not listed

    const list = await exchange.accounts({ actor: agentActor(agent), limit: 50, offset: 0 });
    assert.equal(list.total, 2);
    const row = list.rows.find((r) => r.accountId === String(player));
    assert.equal(Number(row.credit), 1000);
    assert.equal(Number(row.allPoint), 1100);
    assert.equal(Number(row.settlementPoints), 100);
    assert.equal(Number(row.available), 1100);
    const subRow = list.rows.find((r) => r.accountId === String(sub));
    assert.equal(subRow.accountType, 'staff');
    assert.equal(subRow.hasChildren, true);

    const drill = await exchange.accounts({ actor: agentActor(agent), parentId: sub, limit: 50, offset: 0 });
    assert.equal(drill.total, 1);

    const outsider = await seedStaff(newStaffId(), { inr: '0' });
    await assert.rejects(
      () => exchange.accounts({ actor: agentActor(outsider), parentId: sub, limit: 50, offset: 0 }),
      (err) => err.status === 404
    );
  });

  await t.test('Direct Users | Agent Users tab (channel): owner list split', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '0' });
    const child = await seedStaff(newStaffId(), { parentId: owner, inr: '0' });
    const direct = await seedPlayer(newUid(), null, { inr: '5' });
    const ids = (r) => r.rows.map((x) => x.accountId);

    const directTab = await exchange.accounts({ actor: ownerActor(owner), channel: 'direct', search: `settle-player-${direct}`, limit: 50, offset: 0 });
    assert.deepEqual(ids(directTab), [String(direct)]);
    const directAll = await exchange.accounts({ actor: ownerActor(owner), channel: 'direct', limit: 200, offset: 0 });
    assert.ok(directAll.rows.every((r) => r.accountType === 'user'), 'direct tab: koi staff nahi');

    const agentTab = await exchange.accounts({ actor: ownerActor(owner), channel: 'agent', limit: 200, offset: 0 });
    assert.ok(ids(agentTab).includes(String(child)));
    assert.ok(!ids(agentTab).includes(String(direct)), 'agent tab: direct user nahi');

    const both = await exchange.accounts({ actor: ownerActor(owner), search: `settle-player-${direct}`, limit: 50, offset: 0 });
    assert.deepEqual(ids(both), [String(direct)], 'na bheja = purana (dono)');
  });
});
