'use strict';

// Separate transaction password (`staff.transaction_password`), as the other money tests.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { ExchangeService } = require('../exchange.service');
const { LordsService } = require('../../lords/lords.service');
const { StaffService } = require('../../staff/staff.service');

/**
 * Migration 099 rules — sabka balance `credits` me:
 *
 *   - owner apne wallet me balance add karta hai (sirf owner, password ke saath)
 *   - owner apne child ko deta hai → owner ka balance katta hai
 *   - owner DIRECT user (koi parent nahi) ko deta hai → owner ke Direct User balance
 *     (`staff_balances`) se katta hai, credits nahi; history 'direct' + point ledger
 *     'Bank Deposite' / 'Bank Withdraw'
 *   - owner apne Direct User balance me add karta hai → 'owner_direct_topup'
 *   - parent ↔ direct child ke har len-den ki point ledger entry (credit/all_point bhi)
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextStaffId = 970_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);

let nextUid = 820_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const TXN_PASSWORD = 'owner transaction password';

test('owner wallet and the point ledger', async (t) => {
  const logger = createLogger({ name: 'owner-wallet-test', level: 'silent' });

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
  const exchange = new ExchangeService(deps);
  const lords = new LordsService(deps);
  const staffService = new StaffService(deps);

  // Do roles: ek owner (level 1), ek agent (level 6).
  const ownerRole = 8200 + (process.pid % 40); // 8xxx: sirf exchange tests (purane tests 9xxx use karte hain)
  const agentRole = 8250 + (process.pid % 40);
  for (const [id, level] of [[ownerRole, 1], [agentRole, 6]]) {
    await connection.sequelize.query(
      'INSERT INTO roles (id, name, level) VALUES (:id, :name, :level) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level',
      { replacements: { id, name: `owner-wallet-role-${id}`, level } }
    );
  }

  const seedStaff = async (id, { inr = '0', parentId = null, owner = false } = {}) => {
    const { Op } = require('sequelize');
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: id }, { descendant_id: id }] } });
    await models.StaffCredits.destroy({ where: { staff_id: id } });
    // Pichhle run ke is id ke transfers (owner top-up history ginti me na aayein).
    await models.StaffTransfers.destroy({
      where: { [Op.or]: [{ from_type: 'staff', from_id: id }, { to_type: 'staff', to_id: id }] },
    });
    // Ids pid se bante hain — pichhle run ke child staff / players is id ke neeche reh sakte hain.
    await models.Staff.update({ parent_id: null }, { where: { parent_id: id } });
    await models.Users.update({ parent_staff_id: null }, { where: { parent_staff_id: id } });
    await models.Staff.destroy({ where: { id } });

    await models.Staff.create({
      id,
      name: `owner-wallet-${id}`,
      email: `owner-wallet-${id}@test.invalid`,
      password: await hashPassword('login password', 4),
      transaction_password: await hashPassword(TXN_PASSWORD, 4),
      role_id: owner ? ownerRole : agentRole,
      parent_id: parentId,
      status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, user_type: owner ? 'OWNER' : 'STAFF', inr });

    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  const seedPlayer = async (uid, parentStaffId, inr = '0') => {
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.WalletHistory.destroy({ where: { uid } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `owner-wallet-player-${uid}`, password: 'x', status: 'active', parent_staff_id: parentStaffId });
    await models.Credits.create({ uid, inr });
    return uid;
  };

  const dec = (value) => money.toDecimalString(money.toMinorQuantised(value ?? '0'));
  const walletOfStaff = (id) => models.StaffCredits.findOne({ where: { staff_id: id }, raw: true });
  const walletOfPlayer = (uid) => models.Credits.findOne({ where: { uid }, raw: true });
  const directOf = async (id) => dec((await models.StaffBalances.findOne({ where: { staff_id: id }, raw: true }))?.inr);
  const setDirect = async (id, inr) => {
    await models.StaffBalances.destroy({ where: { staff_id: id } });
    if (inr !== null) await models.StaffBalances.create({ staff_id: id, inr });
  };
  const lastPointEntry = async (walletId) => {
    const [row] = await connection.sequelize.query(
      'SELECT * FROM mssports.point_ledger WHERE wallet_id = :walletId ORDER BY id DESC LIMIT 1',
      { replacements: { walletId }, type: 'SELECT' }
    );
    return row;
  };

  const ownerActor = (id) => ({ id, level: 1, canIssueFunds: true });

  let keySeq = 0;
  const ownerAdjust = (owner, userId, operation, amount) =>
    lords.adjustPlayer({
      actor: { id: owner }, // user-service forwards only the id; the service finds out it is the owner
      userId,
      currency: 'INR',
      amount,
      operation,
      description: `owner ${operation}`,
      idempotencyKey: `owner-wallet-test:${process.pid}:${(keySeq += 1)}`,
      transactionPassword: TXN_PASSWORD,
    });

  // ══════════════════════════════════════════════════════════════════════
  //  Owner add balance
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the owner adds balance to its own wallet, recorded as owner_topup', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true });

    const result = await exchange.ownerAddBalance({ actor: ownerActor(owner), amount: '5000', note: 'opening', transactionPassword: TXN_PASSWORD });

    assert.equal(dec(result.balance), '5000.00000000');
    const ownerRow = await walletOfStaff(owner);
    assert.equal(dec(ownerRow.inr), '5000.00000000');
    // Zip (tenexch bundle) jaisa: credit aur all_point bhi, point ledger me 'Credit'.
    assert.equal(dec(ownerRow.credit), '5000.00000000');
    assert.equal(dec(ownerRow.all_point), '5000.00000000');
    const entry = await lastPointEntry(ownerRow.id);
    assert.equal(entry.event_type, 'Credit');
    assert.equal(entry.entry_ref, `deposit:${result.transferId}`);

    const row = await models.StaffTransfers.findByPk(result.transferId, { raw: true });
    assert.equal(row.transfer_type, 'owner_topup');
    assert.equal(row.from_type, 'system');
    assert.equal(String(row.to_id), String(owner));

    const wallet = await exchange.ownerWallet({ actor: ownerActor(owner) });
    assert.equal(dec(wallet.wallet.balance), '5000.00000000');
  });

  await t.test('only the owner can add balance, and only with the transaction password', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true });
    const agent = await seedStaff(newStaffId(), { parentId: owner });

    await assert.rejects(
      () => exchange.ownerAddBalance({ actor: { id: agent, level: 6, canIssueFunds: false }, amount: '10', transactionPassword: TXN_PASSWORD }),
      (err) => err.code === 'EXCHANGE_OWNER_ONLY' && err.status === 403
    );
    await assert.rejects(
      () => exchange.ownerAddBalance({ actor: ownerActor(owner), amount: '10', transactionPassword: 'wrong' }),
      (err) => String(err.code).startsWith('TXN_PASSWORD')
    );
    assert.equal(dec((await walletOfStaff(owner)).inr), '0.00000000', 'nothing added');
  });

  await t.test('the owner adds to the Direct User balance (staff_balances), credits untouched', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '50' });
    await setDirect(owner, null);

    const result = await exchange.ownerAddDirectBalance({ actor: ownerActor(owner), amount: '2500', note: 'direct float', transactionPassword: TXN_PASSWORD });

    assert.equal(dec(result.balance), '2500.00000000');
    assert.equal(await directOf(owner), '2500.00000000');
    assert.equal(dec((await walletOfStaff(owner)).inr), '50.00000000', 'Agent System balance not touched');

    const row = await models.StaffTransfers.findByPk(result.transferId, { raw: true });
    assert.equal(row.transfer_type, 'owner_direct_topup');
    assert.equal(row.from_type, 'system');

    const wallet = await exchange.ownerWallet({ actor: ownerActor(owner) });
    assert.equal(dec(wallet.directBalance), '2500.00000000');
    assert.equal(dec(wallet.wallet.balance), '50.00000000');

    // Sirf owner, password ke saath.
    await assert.rejects(
      () => exchange.ownerAddDirectBalance({ actor: { id: owner, level: 6, canIssueFunds: false }, amount: '10', transactionPassword: TXN_PASSWORD }),
      (err) => err.code === 'EXCHANGE_OWNER_ONLY'
    );
    await assert.rejects(
      () => exchange.ownerAddDirectBalance({ actor: ownerActor(owner), amount: '10', transactionPassword: 'wrong' }),
      (err) => String(err.code).startsWith('TXN_PASSWORD')
    );
    assert.equal(await directOf(owner), '2500.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Owner → child: owner ka balance katta hai
  // ══════════════════════════════════════════════════════════════════════

  await t.test('owner credits its child player: the owner wallet pays, point ledger "Credit"', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '1000' });
    const player = await seedPlayer(newUid(), owner, '0');

    await ownerAdjust(owner, player, 'credit', '300');

    assert.equal(dec((await walletOfStaff(owner)).inr), '700.00000000');
    const wallet = await walletOfPlayer(player);
    assert.equal(dec(wallet.inr), '300.00000000');
    assert.equal(dec(wallet.credit), '300.00000000');
    assert.equal(dec(wallet.all_point), '300.00000000');

    const entry = await lastPointEntry(wallet.id);
    assert.equal(entry.event_type, 'Credit');
    assert.equal(Number(entry.delta), 300);
    assert.equal(Number(entry.closing_inr_balance_parent), 700);
  });

  await t.test('owner cannot give a child more than the owner wallet holds', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '100' });
    const player = await seedPlayer(newUid(), owner, '0');

    await assert.rejects(() => ownerAdjust(owner, player, 'credit', '500'), (err) => err.code === 'INSUFFICIENT_FUNDS');
    assert.equal(dec((await walletOfPlayer(player)).inr), '0.00000000');
  });

  await t.test('owner debits its child player: the money comes back to the owner wallet, point ledger "Debit"', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '0' });
    const player = await seedPlayer(newUid(), owner, '250');

    await ownerAdjust(owner, player, 'debit', '100');

    assert.equal(dec((await walletOfStaff(owner)).inr), '100.00000000');
    const wallet = await walletOfPlayer(player);
    assert.equal(dec(wallet.inr), '150.00000000');
    assert.equal((await lastPointEntry(wallet.id)).event_type, 'Debit');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Owner → direct user: owner ka balance nahi katta
  // ══════════════════════════════════════════════════════════════════════

  await t.test('owner credits a DIRECT user: paid from the Direct User balance, credits untouched, "Bank Deposite"', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '5000' });
    const player = await seedPlayer(newUid(), null, '0');
    await setDirect(owner, '1000');

    const result = await ownerAdjust(owner, player, 'credit', '400');

    assert.equal(dec((await walletOfStaff(owner)).inr), '5000.00000000', 'Agent System balance not charged');
    assert.equal(await directOf(owner), '600.00000000', 'Direct User balance paid');
    assert.equal(dec(result.directBalance), '600.00000000');
    const wallet = await walletOfPlayer(player);
    assert.equal(dec(wallet.inr), '400.00000000');

    const transfer = await models.StaffTransfers.findByPk(result.transferId, { raw: true });
    assert.equal(transfer.transfer_type, 'direct');
    assert.equal((await lastPointEntry(wallet.id)).event_type, 'Bank Deposite');

    // The player's own ledger still reconciles.
    const ledger = await models.CreditsLedger.findByPk(result.ledgerId, { raw: true });
    assert.equal(ledger.reason, 'TRANSFER_IN');
  });

  await t.test('owner cannot give a DIRECT user more than the Direct User balance, even with credits to spare', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '10000' });
    const player = await seedPlayer(newUid(), null, '0');
    await setDirect(owner, '100');

    await assert.rejects(
      () => ownerAdjust(owner, player, 'credit', '500'),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.details?.party === 'owner_direct'
    );
    assert.equal(dec((await walletOfPlayer(player)).inr), '0.00000000');
    assert.equal(await directOf(owner), '100.00000000');
    assert.equal(dec((await walletOfStaff(owner)).inr), '10000.00000000');
  });

  await t.test('owner debits a DIRECT user: the money goes to the Direct User balance, "Bank Withdraw"', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '50' });
    const player = await seedPlayer(newUid(), null, '400');
    await setDirect(owner, null);

    await ownerAdjust(owner, player, 'debit', '150');

    assert.equal(dec((await walletOfStaff(owner)).inr), '50.00000000', 'Agent System balance not credited');
    assert.equal(await directOf(owner), '150.00000000', 'Direct User balance credited');
    const wallet = await walletOfPlayer(player);
    assert.equal(dec(wallet.inr), '250.00000000');
    assert.equal((await lastPointEntry(wallet.id)).event_type, 'Bank Withdraw');
  });

  await t.test('an agent can never reach a direct user', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '0' });
    const agent = await seedStaff(newStaffId(), { parentId: owner, inr: '1000' });
    const player = await seedPlayer(newUid(), null, '0');

    await assert.rejects(
      () => lords.adjustPlayer({
        actor: { id: agent }, userId: player, currency: 'INR', amount: '10', operation: 'credit',
        description: 'x', idempotencyKey: `owner-wallet-test:${process.pid}:agent`, transactionPassword: TXN_PASSWORD,
      }),
      (err) => err.status === 404
    );
    assert.equal(dec((await walletOfPlayer(player)).inr), '0.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Staff transfer: parent ↔ direct child staff
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a staff deposit to a direct child writes the child point entry and its credit/all_point', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '1000' });
    const agent = await seedStaff(newStaffId(), { parentId: owner, inr: '0' });

    await staffService.transfer({
      actor: { ...ownerActor(owner), canAdjustWallets: true, canCredit: true, canDebit: true },
      toType: 'staff', toId: agent, amount: '600', direction: 'deposit', transactionPassword: TXN_PASSWORD,
    });

    assert.equal(dec((await walletOfStaff(owner)).inr), '400.00000000');
    const child = await walletOfStaff(agent);
    assert.equal(dec(child.inr), '600.00000000');
    assert.equal(dec(child.credit), '600.00000000');
    assert.equal(dec(child.all_point), '600.00000000');

    const entry = await lastPointEntry(child.id);
    assert.equal(entry.event_type, 'Credit');
    assert.equal(Number(entry.all_point_after), 600);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Dashboard + point ledger entry
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the dashboard shows the owner wallet and the player gets a point ledger entry', async () => {
    const owner = await seedStaff(newStaffId(), { owner: true, inr: '900' });
    const player = await seedPlayer(newUid(), owner, '0');
    await ownerAdjust(owner, player, 'credit', '100');

    const dash = await exchange.dashboard({ actor: ownerActor(owner) });
    assert.equal(dash.isOwner, true);
    assert.equal(dec(dash.myWallet.balance), '800.00000000');
    assert.ok(dash.players.direct, 'the owner sees direct users');

    const playerWallet = await models.Credits.findOne({ where: { uid: player }, raw: true });
    assert.equal((await lastPointEntry(playerWallet.id)).event_type, 'Credit');
  });
});
