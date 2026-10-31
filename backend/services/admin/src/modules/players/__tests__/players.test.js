'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

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
      v.update.body.safeParse({ username: 'x'.repeat(5), role_id: 1 }).success,
      false
    );
    // Agent ke neeche daalna (parentId) bahar se nahi — sirf Sports Exchange.
    assert.equal(v.update.body.safeParse({ parentId: 5 }).success, false);
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

  // An AGENT's role, not the first one in the table: Super Admin, Admin and Sub
  // Admin are the back office and see every player on the site, so rivals
  // modelled with one of those would not be rivals at all.
  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const agent = newId();
  const rival = newId();
  // Every funded creation below the platform owner needs the transaction
  // password (the Addaplay rule), whatever grants the session holds.
  const OWN_TXN = 'players own txn password';
  const created = [];

  t.before(async () => {
    await models.StaffCredits.destroy({ where: { staff_id: [agent, rival] } });
    await models.Staff.destroy({ where: { id: [agent, rival] } });

    await models.Staff.bulkCreate([
      { id: agent, name: `pa-${agent}`, email: `pa${agent}@t.test`, password: 'x', role_id: roleId, parent_id: null, transaction_password: OWN_TXN },
      { id: rival, name: `pr-${rival}`, email: `pr${rival}@t.test`, password: 'x', role_id: roleId, parent_id: null, transaction_password: OWN_TXN },
    ]);
    await models.StaffCredits.create({ staff_id: agent, inr: '10000' });
    await models.StaffCredits.create({ staff_id: rival, inr: '0' });
  });

  t.after(async () => {
    for (const id of created) {
      await models.CreditsLedger.destroy({ where: { user_id: String(id) } });
      await models.WalletHistory.destroy({ where: { uid: id } });
      await models.StaffTransfers.destroy({
        where: { [require('sequelize').Op.or]: [{ from_id: id }, { to_id: id }] },
      });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    await models.StaffTransfers.destroy({
      where: { [require('sequelize').Op.or]: [{ from_id: agent }, { to_id: agent }] },
    });
    await models.StaffCredits.destroy({ where: { staff_id: [agent, rival] } });
    await models.Staff.destroy({ where: { id: [agent, rival] } });
    if (connection) await connection.close();
  });

  const asAgent = { id: agent, permissions: ['*'] };
  const asRival = { id: rival, permissions: ['*'] };

  const balanceOf = async (staffId) => {
    const row = await models.StaffCredits.findOne({ where: { staff_id: staffId }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  await t.test('a funded creation debits the agent exactly once', async () => {
    const before = await balanceOf(agent);

    const player = await service.create({
      actor: asAgent,
      username: `p${newId()}`,
      password: 'correct-horse-battery',
      initialBalance: '2500',
      transactionPassword: OWN_TXN,
    });
    created.push(Number(player.id));

    assert.equal(player.openingBalance, '2500.00000000');

    const credits = await models.Credits.findOne({ where: { uid: player.id }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(credits.inr)), '2500.00000000');

    assert.equal(
      await balanceOf(agent),
      money.toDecimalString(money.toMinor(before) - money.toMinor('2500'))
    );

    // The player's Ledger tab: one TRANSFER_IN, tied to the staff transfer.
    const ledger = await models.CreditsLedger.findAll({ where: { user_id: String(player.id) }, raw: true });
    assert.equal(ledger.length, 1, 'the opening balance is on the player ledger');
    assert.equal(ledger[0].reason, 'TRANSFER_IN');
    assert.equal(ledger[0].description, 'Opening balance');
    assert.equal(money.toDecimalString(money.toMinor(ledger[0].amount)), '2500.00000000');
    assert.equal(money.toDecimalString(money.toMinor(ledger[0].closing)), '2500.00000000');
    const meta = typeof ledger[0].meta === 'string' ? JSON.parse(ledger[0].meta) : ledger[0].meta;
    assert.equal(meta.refType, 'STAFF_TRANSFER');
    const transfer = await models.StaffTransfers.findByPk(meta.refId, { raw: true });
    assert.equal(transfer.note, 'Opening balance');
    assert.equal(Number(transfer.to_id), Number(player.id));
    const history = await models.WalletHistory.findAll({ where: { uid: player.id }, raw: true });
    assert.equal(history.length, 1);
    assert.equal(history[0].operation, 'credit');
  });

  await t.test('an unfunded creation writes no ledger row', async () => {
    const player = await service.create({ actor: asAgent, username: `p${newId()}`, password: 'correct-horse-battery' });
    created.push(Number(player.id));
    assert.equal(await models.CreditsLedger.count({ where: { user_id: String(player.id) } }), 0);
  });

  await t.test('every admin-created player (any parent) is created WITHOUT a referral code — affiliate is direct-only', async () => {
    const player = await service.create({ actor: asAgent, username: `p${newId()}`, password: 'correct-horse-battery' });
    created.push(Number(player.id));
    assert.equal(player.referralCode, null);
    const row = await models.Users.findOne({ where: { id: player.id }, raw: true });
    assert.equal(row.referalcode, null);
    assert.equal(row.referral_link, null);

    const houseRoleId = (await models.Roles.findOne({ where: { level: 3 }, raw: true }))?.id;
    if (!houseRoleId) return;
    const house = newId();
    await models.Staff.create({ id: house, name: `ph-${house}`, email: `ph${house}@t.test`, password: 'x', role_id: houseRoleId, parent_id: null });
    let housePlayer;
    try {
      housePlayer = await service.create({ actor: { id: house, permissions: ['*'] }, username: `p${newId()}`, password: 'correct-horse-battery' });
      assert.equal(housePlayer.referralCode, null, 'a house-owned player is a child user too — no code');
    } finally {
      if (housePlayer) {
        await models.Credits.destroy({ where: { uid: housePlayer.id } });
        await models.Users.destroy({ where: { id: housePlayer.id } });
      }
      await models.Staff.destroy({ where: { id: house } });
    }
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
          transactionPassword: OWN_TXN,
        }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );

    assert.equal(await balanceOf(rival), before, 'nothing moved');
  });

  await t.test('a funded creation under a DESCENDANT is refused: only the direct parent funds a player', async () => {
    const child = newId();
    await models.Staff.create({ id: child, name: `pc-${child}`, email: `pc${child}@t.test`, password: 'x', role_id: roleId, parent_id: agent });
    try {
      const before = await balanceOf(agent);
      const username = `p${newId()}`;
      await assert.rejects(
        () => service.create({
          actor: asAgent, username, password: 'correct-horse-battery', parentId: child,
          initialBalance: '100', transactionPassword: OWN_TXN,
        }),
        (err) => err.code === 'PLAYERS_NOT_PERMITTED' && err.status === 403
      );
      assert.equal(await balanceOf(agent), before, 'nothing moved');
      assert.equal(await models.Users.count({ where: { name: username } }), 0);

      // Unfunded, under the same descendant, is fine.
      const player = await service.create({ actor: asAgent, username: `p${newId()}`, password: 'correct-horse-battery', parentId: child });
      created.push(Number(player.id));
      await models.Users.update({ parent_staff_id: agent }, { where: { id: player.id } });
    } finally {
      await models.Staff.destroy({ where: { id: child } });
    }
  });

  await t.test('an AGENT-TREE funded creation needs the transaction password; a refusal moves nothing', async () => {
    /**
     * Same rule as `POST /admin/staff/transfer`: an agent-tree session (or
     * anyone without `wallet:adjust`) funding a player out of its own float
     * must give its transaction password. Without this check the opening
     * balance was a second-factor-free way to move float.
     */
    const TXN = 'agent txn password';
    await models.Staff.update({ transaction_password: await hashPassword(TXN, 4) }, { where: { id: agent } });
    const asTreeAgent = { id: agent, level: 6, permissions: ['users:write', 'wallet:credit'] };
    try {
      for (const [transactionPassword, code] of [
        [undefined, 'TXN_PASSWORD_REQUIRED'],
        ['not the password', 'TXN_PASSWORD_INVALID'],
      ]) {
        const before = await balanceOf(agent);
        const username = `p${newId()}`;
        await assert.rejects(
          () => service.create({
            actor: asTreeAgent, username, password: 'correct-horse-battery', initialBalance: '300', transactionPassword,
          }),
          (err) => err.code === code
        );
        assert.equal(await balanceOf(agent), before, 'nothing moved');
        assert.equal(await models.Users.count({ where: { name: username } }), 0, 'no player was created');
      }

      const before = await balanceOf(agent);
      const player = await service.create({
        actor: asTreeAgent, username: `p${newId()}`, password: 'correct-horse-battery', initialBalance: '300', transactionPassword: TXN,
      });
      created.push(Number(player.id));
      assert.equal(await balanceOf(agent), money.toDecimalString(money.toMinor(before) - money.toMinor('300')));

      // An UNFUNDED creation moves no money and needs no second factor.
      const unfunded = await service.create({ actor: asTreeAgent, username: `p${newId()}`, password: 'correct-horse-battery' });
      created.push(Number(unfunded.id));
    } finally {
      await models.Staff.update({ transaction_password: OWN_TXN }, { where: { id: agent } });
    }
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
      transactionPassword: OWN_TXN,
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
    const ledger = await models.CreditsLedger.count({
      where: { user_id: String(playerId), description: 'must survive an account closure' },
    });
    assert.equal(ledger, 1, 'THE LEDGER ROW IS STILL THERE');
    const reasons = (await models.CreditsLedger.findAll({ where: { user_id: String(playerId) }, raw: true })).map((r) => r.reason).sort();
    assert.deepEqual(reasons, ['BET_PAYOUT', 'TRANSFER_IN', 'TRANSFER_OUT'], 'opening balance in, closing return out');

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
