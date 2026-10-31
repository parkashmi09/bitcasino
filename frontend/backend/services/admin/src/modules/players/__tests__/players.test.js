'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { PlayersService } = require('../players.service');
const v = require('../players.validators');

/**
 * Player accounts.
 *
 * The test that matters is the last one: closing an account must NOT destroy
 * the financial record. Legacy's delete read `information_schema.columns` for
 * anything named `user_id`/`uid`/… and DELETEd from every one of those tables.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextId = 600_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('player validators', async (t) => {
  await t.test('an opening balance is a positive decimal STRING', () => {
    /**
     * `initial_balance` came off the body unvalidated in legacy and was
     * compared with `>` against a balance read.
     */
    const parse = (initialBalance) =>
      v.create.body.safeParse({ username: 'someone', password: 'correct-horse', initialBalance });

    assert.equal(parse('1000.50').success, true);
    assert.equal(parse('-500').success, false, 'a negative would run the transfer backwards');
    assert.equal(parse(1000).success, false, 'a number is not a decimal string');
    assert.equal(parse('1e5').success, false);
    assert.equal(parse('abc').success, false);
  });

  await t.test('a close needs a reason', () => {
    // Legacy recorded that a delete happened and nothing about why, for an
    // action that was irreversible.
    assert.equal(v.close.body.safeParse({}).success, false);
    assert.equal(v.close.body.safeParse({ reason: 'Duplicate account' }).success, true);
  });

  await t.test('an empty update is refused rather than silently doing nothing', () => {
    assert.equal(v.update.body.safeParse({}).success, false);
  });

  await t.test('unknown fields are rejected, not ignored', () => {
    // `.strict()` — a caller sending `role_id` or `parent_staff_id` directly
    // gets an error rather than having it quietly dropped.
    assert.equal(
      v.create.body.safeParse({ username: 'x'.repeat(5), password: 'correct-horse', role_id: 1 }).success,
      false
    );
  });
});

test('players against a database', async (t) => {
  const logger = createLogger({ name: 'players-test', level: 'silent' });

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
  const service = new PlayersService({ models, db: connection, logger, config: {} });

  const roleId = (await models.Roles.findOne({ raw: true }))?.id ?? 1;

  const agent = newId();
  const rival = newId();
  const created = [];

  t.before(async () => {
    await models.StaffBalances.destroy({ where: { staff_id: [agent, rival] } });
    await models.Staff.destroy({ where: { id: [agent, rival] } });

    await models.Staff.bulkCreate([
      { id: agent, name: `pa-${agent}`, email: `pa${agent}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: rival, name: `pr-${rival}`, email: `pr${rival}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);
    await models.StaffBalances.create({ staff_id: agent, inr: '10000' });
    await models.StaffBalances.create({ staff_id: rival, inr: '0' });
  });

  t.after(async () => {
    for (const id of created) {
      await models.CreditsLedger.destroy({ where: { user_id: String(id) } });
      await models.StaffTransfers.destroy({
        where: { [require('sequelize').Op.or]: [{ from_id: id }, { to_id: id }] },
      });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    await models.StaffTransfers.destroy({
      where: { [require('sequelize').Op.or]: [{ from_id: agent }, { to_id: agent }] },
    });
    await models.StaffBalances.destroy({ where: { staff_id: [agent, rival] } });
    await models.Staff.destroy({ where: { id: [agent, rival] } });
    if (connection) await connection.close();
  });

  const asAgent = { id: agent, permissions: ['*'] };
  const asRival = { id: rival, permissions: ['*'] };

  const balanceOf = async (staffId) => {
    const row = await models.StaffBalances.findOne({ where: { staff_id: staffId }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  await t.test('a funded creation debits the agent exactly once', async () => {
    const before = await balanceOf(agent);

    const player = await service.create({
      actor: asAgent,
      username: `p${newId()}`,
      password: 'correct-horse-battery',
      initialBalance: '2500',
    });
    created.push(Number(player.id));

    assert.equal(player.openingBalance, '2500.00000000');

    const credits = await models.Credits.findOne({ where: { uid: player.id }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(credits.inr)), '2500.00000000');

    assert.equal(
      await balanceOf(agent),
      money.toDecimalString(money.toMinor(before) - money.toMinor('2500'))
    );
  });

  await t.test('the password is HASHED and password2 is left empty', async () => {
    const player = await service.create({
      actor: asAgent,
      username: `p${newId()}`,
      password: 'correct-horse-battery',
    });
    created.push(Number(player.id));

    const row = await models.Users.findOne({ where: { id: player.id }, raw: true });
    assert.notEqual(row.password, 'correct-horse-battery');
    assert.ok(row.password.startsWith('$2'), 'a bcrypt hash');
    // Legacy wrote the plaintext here. Fifth site in the codebase to do so.
    assert.equal(row.password2, null);
  });

  await t.test('funding beyond the agent balance is refused and moves nothing', async () => {
    const before = await balanceOf(rival);

    await assert.rejects(
      () =>
        service.create({
          actor: asRival,
          username: `p${newId()}`,
          password: 'correct-horse-battery',
          initialBalance: '999999',
        }),
      (err) => err.code === 'PLAYERS_INSUFFICIENT_FUNDS'
    );

    assert.equal(await balanceOf(rival), before, 'nothing moved');
  });

  await t.test('a negative opening balance is refused', async () => {
    // It would have run the transfer backwards — money FROM the new player.
    await assert.rejects(
      () =>
        service.create({
          actor: asAgent,
          username: `p${newId()}`,
          password: 'correct-horse-battery',
          initialBalance: '-500',
        }),
      (err) => err.code === 'PLAYERS_NOT_PERMITTED'
    );
  });

  await t.test('a player cannot be re-parented outside the caller\'s tree', async () => {
    /**
     * Legacy wrote `parent_staff_id` straight from the body with no check, so
     * an agent could hand any player they could see to any staff id at all.
     */
    const player = await service.create({
      actor: asAgent,
      username: `p${newId()}`,
      password: 'correct-horse-battery',
    });
    created.push(Number(player.id));

    await assert.rejects(
      () => service.update({ actor: asAgent, playerId: player.id, parentId: rival }),
      (err) => err.code === 'PLAYERS_CANNOT_REPARENT_OUTSIDE_TREE'
    );

    const row = await models.Users.findOne({ where: { id: player.id }, raw: true });
    assert.equal(String(row.parent_staff_id), String(agent));
  });

  await t.test('an agent cannot edit a rival\'s player', async () => {
    const player = await service.create({
      actor: asAgent,
      username: `p${newId()}`,
      password: 'correct-horse-battery',
    });
    created.push(Number(player.id));

    await assert.rejects(
      () => service.update({ actor: asRival, playerId: player.id, phone: '999' }),
      (err) => err.code === 'PLAYERS_NOT_FOUND'
    );
  });

  await t.test('CLOSING AN ACCOUNT KEEPS THE FINANCIAL RECORD', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * THE TEST THIS FILE EXISTS FOR
     *
     * Legacy's `deletePlayer`:
     *
     *     const possCols = ['user_id','userid','uid','id_user','user'];
     *     SELECT table_name, column_name FROM information_schema.columns
     *      WHERE table_schema='public' AND lower(column_name) = ANY($1)
     *     …
     *     for (const {table, col} of targets)
     *       await pg.query(`DELETE FROM "${table}" WHERE "${col}" = $1`, [id]);
     *
     * On this schema that reaches `credits_ledger`, `SportsBet`,
     * `gis_transactions`, `fiat_deposits`, `fiat_withdrawals` and more. The
     * ledger row seeded below is exactly the kind of record it destroyed.
     * ═══════════════════════════════════════════════════════════════════
     */
    const player = await service.create({
      actor: asAgent,
      username: `p${newId()}`,
      password: 'correct-horse-battery',
      initialBalance: '750',
    });
    const playerId = Number(player.id);
    created.push(playerId);

    // A financial record that must survive.
    await models.CreditsLedger.create({
      user_id: String(playerId),
      currency: 'INR',
      amount: '100',
      netamount: '100',
      reason: 'BET_PAYOUT',
      description: 'must survive an account closure',
      created_at: new Date(),
    });

    const agentBefore = await balanceOf(agent);

    const result = await service.close({ actor: asAgent, playerId, reason: 'Test closure' });

    assert.equal(result.status, 'closed');
    assert.equal(result.balanceReturned, '750.00000000');

    // ── the record survives ──
    const ledger = await models.CreditsLedger.count({ where: { user_id: String(playerId) } });
    assert.equal(ledger, 1, 'THE LEDGER ROW IS STILL THERE');

    const transfers = await models.StaffTransfers.count({
      where: { [require('sequelize').Op.or]: [{ from_id: playerId }, { to_id: playerId }] },
    });
    assert.ok(transfers >= 2, 'the opening deposit and the closing return are both recorded');

    // ── the person does not ──
    const row = await models.Users.findOne({ where: { id: playerId }, raw: true });
    assert.equal(row.status, 'closed');
    assert.equal(row.email, null);
    assert.equal(row.phone, null);
    assert.equal(row.password2, null);
    assert.equal(row.name, `closed-${playerId}`);
    assert.equal(row.system_locked, true);

    // ── the money went back up, it did not vanish ──
    const credits = await models.Credits.findOne({ where: { uid: playerId }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(credits.inr)), '0.00000000');
    assert.equal(
      await balanceOf(agent),
      money.toDecimalString(money.toMinor(agentBefore) + money.toMinor('750')),
      'legacy deleted the credits row and the balance simply ceased to exist'
    );
  });

  await t.test('closing twice is refused', async () => {
    const player = await service.create({
      actor: asAgent,
      username: `p${newId()}`,
      password: 'correct-horse-battery',
    });
    created.push(Number(player.id));

    await service.close({ actor: asAgent, playerId: player.id, reason: 'first' });
    await assert.rejects(
      () => service.close({ actor: asAgent, playerId: player.id, reason: 'second' }),
      (err) => err.code === 'PLAYERS_ALREADY_CLOSED'
    );
  });

  await t.test('a duplicate username is a 409, not a 500', async () => {
    const name = `dup${newId()}`;
    const first = await service.create({ actor: asAgent, username: name, password: 'correct-horse-battery' });
    created.push(Number(first.id));

    await assert.rejects(
      () => service.create({ actor: asAgent, username: name.toUpperCase(), password: 'correct-horse-battery' }),
      (err) => err.code === 'PLAYERS_ALREADY_EXISTS' && err.status === 409
    );
  });
});
