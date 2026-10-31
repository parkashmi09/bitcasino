'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { AgentLedgerService } = require('../agentLedger.service');

/** Agent System tab: point ledger se deposit (+) / withdraw (−), bet rows nahi, sirf apne tree ka. */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

test('agent ledger against a database', async (t) => {
  const logger = createLogger({ name: 'agent-ledger-test', level: 'silent' });
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
  const service = new AgentLedgerService({ models, logger });
  const q = (sql, replacements) => sequelize.query(sql, { replacements });

  const roleId = 8600 + (process.pid % 40);
  await q('INSERT INTO roles (id, name, level) VALUES (:id, :name, 6) ON CONFLICT (id) DO UPDATE SET level = 6', { id: roleId, name: `al-agent-${roleId}` });
  const agent = 976_000 + (process.pid % 1000);
  const other = agent + 1000;
  const uid = 837_000_000 + (process.pid % 100_000);
  const ref = `al-test-${process.pid}`;

  const cleanup = async () => {
    await q('DELETE FROM mssports.point_ledger WHERE entry_ref LIKE :ref', { ref: `${ref}%` });
    await q('DELETE FROM credits WHERE uid = :uid OR staff_id IN (:staff)', { uid, staff: [agent, other] });
    await models.Users.destroy({ where: { id: uid } });
    await models.Staff.destroy({ where: { id: [agent, other] } });
  };
  await cleanup();
  for (const id of [agent, other]) {
    await models.Staff.create({ id, name: `al-${id}`, email: `al-${id}@test.invalid`, password: 'x', role_id: roleId, status: 'active' });
  }
  await models.Users.create({ id: uid, name: `al-player-${uid}`, password: 'x', status: 'active', parent_staff_id: agent });
  const [[userWallet]] = await q("INSERT INTO credits (uid, user_type) VALUES (:uid, 'USER') RETURNING id", { uid });
  const [[agentWallet]] = await q("INSERT INTO credits (staff_id, user_type) VALUES (:id, 'STAFF') RETURNING id", { id: agent });
  const [[otherWallet]] = await q("INSERT INTO credits (staff_id, user_type) VALUES (:id, 'STAFF') RETURNING id", { id: other });

  const entry = (n, event, delta, parentWallet, betId = null) =>
    q(
      `INSERT INTO mssports.point_ledger (entry_ref, event_type, username, wallet_id, settled_with_wallet_id, delta, bet_id, remark, created_at)
       VALUES (:ref, :event, 'p', :w, :pw, :delta, :bet, 'note#a/b', now())`,
      { ref: `${ref}-${n}`, event, w: userWallet.id, pw: parentWallet, delta, bet: betId }
    );
  await entry(1, 'Credit', '100', agentWallet.id);
  await entry(2, 'Debit', '-40', agentWallet.id);
  await entry(3, 'BET_SETTLEMENT', '500', agentWallet.id, 1); // bet — nahi aana chahiye
  await entry(4, 'Credit', '999', otherWallet.id); // dusre agent ka — nahi aana chahiye

  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  const actor = { id: agent, level: 6 };

  await t.test('deposit: agent → player credit only', async () => {
    const r = await service.list({ actor, direction: 'deposit' });
    assert.equal(r.total, 1);
    assert.equal(Number(r.sum), 100);
    assert.deepEqual([r.rows[0].from.id, r.rows[0].to.id, r.rows[0].type, r.rows[0].remark], [String(agent), String(uid), 'Credit', 'note']);
  });

  await t.test('withdraw: player → agent, positive amount, min filter', async () => {
    const r = await service.list({ actor, direction: 'withdraw' });
    assert.equal(r.total, 1);
    assert.equal(Number(r.rows[0].amount), 40);
    assert.equal(r.rows[0].to.id, String(agent));
    assert.equal((await service.list({ actor, direction: 'withdraw', min: '50' })).total, 0);
  });
});
