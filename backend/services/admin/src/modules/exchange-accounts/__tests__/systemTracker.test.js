'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { CreateAccountService } = require('../createAccount');
const { runChecks, getActiveAlerts } = require('../systemTracker/scanner');
const { buildAccountReport, searchAccounts } = require('../systemTracker/report');
const { buildProvenance } = require('../systemTracker/provenance');
const { scanWatchdog, getActiveWatchdog, acknowledgeFinding } = require('../systemTracker/watchdog');
const migration104 = require('../../../../../../packages/db/migrations/104-exchange-accounts-tables');

/**
 * System Tracker — zip ka integrity scanner, account trace, provenance aur watchdog,
 * hamare credits / point_ledger pe.
 *
 *   all_point ≠ SUM(point_ledger.delta)  → pointLedgerDrift (critical)
 *   saaf account                          → koi finding nahi, report "All checks pass"
 *   open bet, match ghanton pehle shuru    → watchdog staleOpenMarket, bet band → resolve
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TXN = 'tracker txn password';
const tag = `${process.pid % 100000}`;

let connection;
let nextStaffId = 1_250_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);
let nextUid = 860_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('system tracker', async (t) => {
  const logger = createLogger({ name: 'system-tracker-test', level: 'silent' });

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
  const sequelize = connection.sequelize;
  const sql = (query, replacements) => sequelize.query(query, { replacements, type: 'SELECT' });
  await sequelize.transaction((transaction) => migration104.up({ sequelize, transaction }));

  const deps = { models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' } };

  const seedStaff = async ({ roleId, parentId = null, inr = '0' }) => {
    const id = newStaffId();
    await models.Staff.create({
      id,
      name: `trk${tag}s${id}`,
      email: `trk-${id}@test.invalid`,
      password: await hashPassword('login password', 4),
      transaction_password: await hashPassword(TXN, 4),
      role_id: roleId,
      parent_id: parentId,
      status: 'active',
    });
    await models.StaffCredits.create({ staff_id: id, user_type: roleId === 1 ? 'OWNER' : 'STAFF', inr });
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await models.StaffHierarchy.findAll({ where: { descendant_id: parentId }, raw: true });
      rows.push(...ancestors.map((a) => ({ ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1 })));
    }
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    return id;
  };

  const seedPlayer = async (parentStaffId, allPoint) => {
    const uid = newUid();
    await models.Users.create({ id: uid, name: `trk${tag}p${uid}`, password: 'x', status: 'active', parent_staff_id: parentStaffId });
    await models.Credits.create({ uid, inr: '0', credit: '0', all_point: allPoint });
    return uid;
  };

  const ownerId = await seedStaff({ roleId: 1, inr: '5000' });
  const agentId = await seedStaff({ roleId: 6, parentId: ownerId, inr: '1000' });
  const agentActors = {
    staffActor: { id: agentId, level: 6, executiveId: null, permissions: ['users:write', 'wallet:credit'], canIssueFunds: false },
    playerActor: { id: agentId, level: 6, executiveId: null, permissions: ['users:write', 'wallet:credit'] },
  };

  // Saaf player — agent ne Credit Amount 200 diya (point ledger entry ke saath).
  const accounts = new CreateAccountService(deps);
  const cleanName = `trk${tag}clean`;
  await accounts.create({ ...agentActors, username: cleanName, password: 'Player1234', creditAmount: '200', userType: 'USER', transactionPassword: TXN });
  const clean = await models.Users.findOne({ where: { name: cleanName }, raw: true });

  // Bigda player — all_point 50 par ledger me kuch nahi.
  const drifted = await seedPlayer(agentId, '50');

  await t.test('scan flags the drifted wallet and leaves the clean one alone', async () => {
    const summary = await runChecks(sequelize, logger);
    assert.ok(summary.totalFindings >= 1);

    const alerts = await getActiveAlerts(sequelize);
    const bad = alerts.users.find((u) => u.user_id === String(drifted));
    assert.ok(bad, 'drifted player is on the board');
    const drift = bad.issues.find((i) => i.key === 'pointLedgerDrift');
    assert.equal(drift.severity, 'critical');
    assert.match(drift.detail, /all_point 50\.00 ≠ ledger SUM 0\.00/);
    assert.ok(!alerts.users.some((u) => u.user_id === String(clean.id)), 'clean player has no finding');
  });

  await t.test('fixing the wallet resolves the finding on the next scan', async () => {
    await models.Credits.update({ all_point: '0' }, { where: { uid: drifted } });
    await runChecks(sequelize, logger);
    const alerts = await getActiveAlerts(sequelize);
    assert.ok(!alerts.users.some((u) => u.user_id === String(drifted)));
    const [row] = await sql(`SELECT resolved_at FROM mssports.integrity_alerts WHERE user_id = :id AND check_key = 'pointLedgerDrift'`, { id: String(drifted) });
    assert.ok(row.resolved_at);
  });

  await t.test('account trace: player report, search, and an agent report', async () => {
    const found = await searchAccounts(sequelize, cleanName);
    assert.equal(found[0].username, cleanName);

    const report = await buildAccountReport(sequelize, cleanName);
    assert.equal(report.found, true);
    assert.equal(report.snapshot.available_balance, 200);
    const ledger = report.categories.find((c) => c.key === 'ledger');
    assert.equal(ledger.pass, true);
    assert.equal(ledger.rules[0].subs[0].actual, 200);
    const hierarchy = report.categories.find((c) => c.key === 'hierarchy');
    assert.equal(hierarchy.pass, true, 'player → agent → owner');
    assert.equal(report.allPass, true);

    const agentReport = await buildAccountReport(sequelize, String(agentId));
    assert.equal(agentReport.snapshot.kind, 'staff');
    assert.ok(agentReport.categories.find((c) => c.key === 'hierarchy').rules.find((r) => r.label === 'Direct downline').actual >= 2);

    assert.equal((await buildAccountReport(sequelize, 'nobody-here-xyz')).found, false);
  });

  await t.test('provenance: the 200 came from the upline and the balance reconciles', async () => {
    const prov = await buildProvenance(sequelize, String(clean.id));
    assert.equal(prov.found, true);
    const fromUpline = prov.buckets.find((b) => b.key === 'in_from_upline');
    assert.equal(fromUpline.amount, 200);
    assert.equal(fromUpline.events[0].counterparty, `trk${tag}s${agentId}`);
    assert.equal(prov.reconciliation.pass, true);
    assert.equal(prov.upline[0].id, String(agentId));
    assert.equal(prov.upline[prov.upline.length - 1].kind, 'owner');
  });

  await t.test('watchdog: a stale open market is found, acknowledged, and resolves when the bet closes', async () => {
    const eventId = `trk-${tag}-${Date.now()}`;
    // SportsBet.user_id → mssports.users (sports service ka mirror) — wahan bhi player chahiye.
    await sequelize.query(
      `INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt")
       VALUES (:uid, :name, 'x', 8, now(), now()) ON CONFLICT (user_id) DO NOTHING`,
      { replacements: { uid: clean.id, name: cleanName } }
    );
    const [bet] = await sql(
      `INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, stake_amount, market_type, selection_name,
                                         match_title, match_id, eventid, status, match_start_time, created_at, updated_at)
       VALUES (:uid, 'MO', 'back', 2, 100, 'MATCH_ODDS', 'Team A', 'Team A v Team B', :eventId, :eventId, 'open',
               now() - interval '20 hours', now(), now())
       RETURNING id`,
      { uid: clean.id, eventId }
    );

    await scanWatchdog(sequelize, logger);
    let board = await getActiveWatchdog(sequelize);
    const finding = board.findings.find((f) => f.kind === 'staleOpenMarket' && f.event_id === eventId);
    assert.ok(finding, 'stale market is on the board');
    assert.equal(Number(finding.stake_total), 100);
    assert.ok(board.thresholds.STALE_HOURS > 0);

    const acked = await acknowledgeFinding(sequelize, finding.id, 'tester');
    assert.equal(acked.acknowledged_by, 'tester');

    await sequelize.query(`UPDATE mssports."SportsBet" SET status = 'closed', result_status = 'loss' WHERE id = :id`, { replacements: { id: bet.id } });
    await scanWatchdog(sequelize, logger);
    board = await getActiveWatchdog(sequelize);
    assert.ok(!board.findings.some((f) => f.id === finding.id), 'resolved once the bet closed');

    await sequelize.query('DELETE FROM mssports."SportsBet" WHERE id = :id', { replacements: { id: bet.id } });
  });
});
