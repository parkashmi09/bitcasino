'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { WagerService } = require('../wager.service');
const v = require('../wager.validators');

/**
 * Wagering requirements (targetX).
 *
 * The listing is what this file mostly exists for. It is the screen an operator
 * uses to decide whether a player is close enough to their target to withdraw,
 * so the money has to be IN the list — legacy assembled it by calling the
 * per-player progress endpoint once per row, which is one request per player on
 * every refresh, and the two could disagree because they were separate queries
 * written separately.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 880_000_000 + (process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('wager validators', async (t) => {
  await t.test('the multiplier is a decimal, carried as a string', () => {
    // `wager_multiplier_common.multiplier` is an INTEGER column, so 2.5x cannot
    // live there — per-player values are numeric and travel as strings.
    assert.equal(v.setForAll.body.safeParse({ multiplier: '2.5' }).success, true);
    assert.equal(v.setForAll.body.safeParse({ multiplier: 2.5 }).success, false);
    assert.equal(v.setForAll.body.safeParse({ multiplier: '0' }).success, false);
    assert.equal(v.setForAll.body.safeParse({ multiplier: '101' }).success, false);
  });

  await t.test('the listing pages, with a ceiling', () => {
    assert.equal(v.list.query.parse({}).limit, 50);
    assert.equal(v.list.query.safeParse({ limit: '5000' }).success, false);
  });

  await t.test('the listing is about direct signups unless asked otherwise', () => {
    // The screen sets the PLATFORM's multiplier; an agent's player has their
    // own negotiated rate. Direct is the default, but it stays a filter.
    assert.equal(v.list.query.parse({}).channel, 'direct');
    assert.equal(v.list.query.parse({ channel: 'all' }).channel, 'all');
    assert.equal(v.list.query.safeParse({ channel: 'affiliate' }).success, false);
  });
});

test('the wager listing carries the money', async (t) => {
  const logger = createLogger({ name: 'wager-test', level: 'silent' });

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
  const service = new WagerService({ models, db: connection, logger });

  const player = newUid();
  const name = `wager-test-${player}`;

  // A second player, onboarded under an agent. Same name prefix so one
  // `search` reaches both, which is what makes the channel filter observable.
  const agentPlayer = newUid();
  const agentStaff = 9_960_000 + (process.pid % 1000);
  const agentRole = 9_960 + (process.pid % 30);

  t.before(async () => {
    await models.Users.destroy({ where: { id: [player, agentPlayer] } });
    await models.Users.create({
      id: player,
      name,
      email: `w${player}@t.test`,
      password: 'x',
      status: 'active',
      wager_multiplier: '3',
    });

    // `parent_staff_id` is a foreign key, so the agent has to exist.
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:roleId, :roleName, 3) ON CONFLICT (id) DO NOTHING`,
      { replacements: { roleId: agentRole, roleName: `wager-role-${agentRole}` } }
    );
    await connection.sequelize.query(
      `INSERT INTO staff (id, name, email, password, role_id, status)
         VALUES (:id, :name, :email, 'x', :roleId, 'active')
       ON CONFLICT (id) DO NOTHING`,
      {
        replacements: {
          id: agentStaff,
          name: `wager-staff-${agentStaff}`,
          email: `ws${agentStaff}@t.test`,
          roleId: agentRole,
        },
      }
    );
    await models.Users.create({
      id: agentPlayer,
      name: `${name}-agent`,
      email: `w${agentPlayer}@t.test`,
      password: 'x',
      status: 'active',
      wager_multiplier: '3',
      parent_staff_id: agentStaff,
    });

    await models.FiatDeposits.destroy({ where: { user_id: player } });
    await models.FiatDeposits.bulkCreate([
      { user_id: player, amount: '1000', currency: 'INR', status: 'approved' },
      { user_id: player, amount: '500', currency: 'INR', status: 'approved' },
      // Not approved — it has not funded anything, so it raises no target.
      { user_id: player, amount: '9000', currency: 'INR', status: 'pending' },
    ]);

    await models.Userwager.destroy({ where: { uid: player } });
    await models.Userwager.create({ uid: player, wager: '900' });
  });

  t.after(async () => {
    await models.Userwager.destroy({ where: { uid: player } });
    await models.FiatDeposits.destroy({ where: { user_id: player } });
    await models.Users.destroy({ where: { id: [player, agentPlayer] } });
    await connection.sequelize.query(`DELETE FROM staff WHERE id = :id`, { replacements: { id: agentStaff } });
    if (connection) await connection.close();
  });

  await t.test('an agent\'s player is out of the listing unless it is asked for', async () => {
    /**
     * `users.parent_staff_id IS NULL` is a direct signup. The screen sets the
     * platform's own multiplier, so it answers about its own players by
     * default — but `channel` is a filter, not a hard-coded `WHERE`.
     */
    const direct = await service.listMultipliers({ search: name, limit: 50, offset: 0 });
    assert.deepEqual(direct.rows.map((r) => r.userId), [player]);

    const all = await service.listMultipliers({ search: name, channel: 'all', limit: 50, offset: 0 });
    assert.deepEqual(all.rows.map((r) => r.userId).sort(), [player, agentPlayer].sort());

    const agent = await service.listMultipliers({ search: name, channel: 'agent', limit: 50, offset: 0 });
    assert.deepEqual(agent.rows.map((r) => r.userId), [agentPlayer]);

    // `count` drives the pager — a filtered listing whose total counts the
    // rows it excluded pages into blank screens.
    assert.equal(direct.count, 1);
    assert.equal(all.count, 2);
  });

  await t.test('a row carries deposits, target, wagered and the percentage', async () => {
    const { rows } = await service.listMultipliers({ search: name, limit: 50, offset: 0 });
    assert.equal(rows.length, 1);

    const row = rows[0];
    assert.equal(row.totalDeposited, '1500.00000000', 'the pending deposit is not counted');
    assert.equal(row.target, '4500.00000000', '1500 at 3x');
    assert.equal(row.wagered, '900.00000000');
    assert.equal(row.remaining, '3600.00000000');
    assert.equal(row.percentage, '20.00');
    assert.equal(row.met, false);
  });

  await t.test('the list and the per-player read agree about the same player', async () => {
    /**
     * They are separate queries over the same definitions. If they ever drift,
     * the operator sees one figure on the list and another on the detail and
     * has no way to tell which is real.
     */
    const { rows } = await service.listMultipliers({ search: name, limit: 50, offset: 0 });
    const progress = await service.getProgress(player);

    assert.equal(rows[0].totalDeposited, progress.totalDeposited);
    assert.equal(rows[0].target, progress.target);
    assert.equal(rows[0].wagered, progress.wagered);
    assert.equal(rows[0].remaining, progress.remaining);
    assert.equal(rows[0].met, progress.met);
  });

  await t.test('a player who has deposited nothing is complete, not a divide by zero', async () => {
    await models.FiatDeposits.destroy({ where: { user_id: player } });

    const { rows } = await service.listMultipliers({ search: name, limit: 50, offset: 0 });
    assert.equal(rows[0].target, '0.00000000');
    assert.equal(rows[0].percentage, '100.00');
    assert.equal(rows[0].met, true, 'and it agrees with getProgress');
  });
});
