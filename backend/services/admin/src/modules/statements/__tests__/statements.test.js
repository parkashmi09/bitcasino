'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Op } = require('sequelize');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { StatementsService } = require('../statements.service');
const { renderStatement } = require('../statementPdf');

/**
 * Statements against the real schema.
 *
 * `ledger.test.js` covers the arithmetic. This covers the queries — which is
 * where a column that does not exist hides, and how three of this port's
 * findings were found.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextId = 300_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('statements against a database', async (t) => {
  const logger = createLogger({ name: 'statements-test', level: 'silent' });

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
  const service = new StatementsService({ models, db: connection, logger, config: {} });

  const roleId = (await models.Roles.findOne({ raw: true }))?.id ?? 1;

  const agent = newId();
  const outsider = newId();
  const player = newId();

  t.before(async () => {
    await models.CreditsLedger.destroy({ where: { user_id: String(player) } });
    await models.StaffTransfers.destroy({
      where: { [Op.or]: [{ from_id: player }, { to_id: player }, { from_id: agent }, { to_id: agent }] },
    });
    await models.Credits.destroy({ where: { uid: player } });
    await models.Users.destroy({ where: { id: player } });
    await models.StaffBalances.destroy({ where: { staff_id: [agent, outsider] } });
    await models.Staff.destroy({ where: { id: [agent, outsider] } });

    await models.Staff.bulkCreate([
      { id: agent, name: `sa-${agent}`, email: `sa${agent}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: outsider, name: `so-${outsider}`, email: `so${outsider}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);
    await models.StaffBalances.create({ staff_id: agent, inr: '5000' });

    await models.Users.create({ id: player, name: 'Statement Player', password: 'x', status: 'active', parent_staff_id: agent });
    await models.Credits.create({ uid: player, inr: '1200' });

    // A deposit from the agent...
    await models.StaffTransfers.create({
      from_type: 'staff', from_id: agent, to_type: 'user', to_id: player,
      amount: '1000', direction: 'deposit', transfer_type: 'transfer',
      created_at: new Date('2026-01-05T10:00:00Z'),
    });

    // ...a sports win...
    await models.CreditsLedger.create({
      user_id: String(player), currency: 'INR', amount: '300', netamount: '300',
      reason: 'BET_PAYOUT', description: 'won', created_at: new Date('2026-01-06T10:00:00Z'),
    });

    /**
     * ...and a CRYPTO DEPOSIT, in the same ledger table.
     *
     * This row is the reason the sports P&L is filtered by reason. Legacy read
     * every `credits_ledger` row and labelled it "Sports bet won" — because in
     * legacy the settlement worker was the only writer. This port's deposits,
     * bonuses, swaps and gift cards all write here.
     */
    await models.CreditsLedger.create({
      user_id: String(player), currency: 'INR', amount: '9999', netamount: '9999',
      reason: 'DEPOSIT', description: 'crypto deposit — NOT a bet', created_at: new Date('2026-01-07T10:00:00Z'),
    });
  });

  t.after(async () => {
    await models.CreditsLedger.destroy({ where: { user_id: String(player) } });
    await models.StaffTransfers.destroy({
      where: { [Op.or]: [{ from_id: player }, { to_id: player }, { from_id: agent }, { to_id: agent }] },
    });
    await models.Credits.destroy({ where: { uid: player } });
    await models.Users.destroy({ where: { id: player } });
    await models.StaffBalances.destroy({ where: { staff_id: [agent, outsider] } });
    await models.Staff.destroy({ where: { id: [agent, outsider] } });
    if (connection) await connection.close();
  });

  const asAgent = { id: agent, permissions: ['*'] };
  const asOutsider = { id: outsider, permissions: ['*'] };

  await t.test('a player statement runs and anchors on the live wallet', async () => {
    const statement = await service.userStatement({ staff: asAgent, userId: player });

    assert.equal(statement.subject.type, 'USER');
    assert.equal(statement.balance.live, '1200.00000000');
    assert.ok(statement.rows.length > 0);
    // Newest first, and the first row carries the closing balance.
    assert.equal(statement.rows[0].balance, statement.balance.closing);
  });

  await t.test('A DEPOSIT IN credits_ledger IS NOT COUNTED AS A BET WON', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * Legacy:
     *
     *     SELECT created_at, netamount, … FROM credits_ledger
     *      WHERE user_id::text = $1 AND upper(currency)='INR'
     *
     * — every row, labelled `net >= 0 ? 'Sports bet won' : 'Sports bet lost'`.
     * The 9999 crypto deposit seeded above would appear as a sports win and
     * the player's sports P&L would read +10,299 instead of +300.
     * ═══════════════════════════════════════════════════════════════════
     */
    const statement = await service.userStatement({ staff: asAgent, userId: player });

    assert.equal(statement.gaming.sports.playerPnl, '300.00000000', 'the bet, and only the bet');

    const sportsRows = statement.rows.filter((r) => r.kind === 'SPORTS');
    assert.equal(sportsRows.length, 1);
    assert.equal(sportsRows[0].label, 'Sports bet won');
  });

  await t.test('an agent statement runs over the whole tree', async () => {
    const statement = await service.agentStatement({ staff: asAgent, staffId: agent });

    assert.equal(statement.subject.type, 'STAFF');
    assert.equal(statement.balance.live, '5000.00000000');
    // The agent gave the player 1000, so it left their wallet.
    assert.equal(statement.balance.givenPlayers, '1000.00000000');
    assert.ok(statement.players.some((p) => p.id === String(player)));
  });

  await t.test('the agent keeps what the player lost, and the signs agree', async () => {
    const statement = await service.agentStatement({ staff: asAgent, staffId: agent });

    // The player won 300, so the agent is down 300.
    assert.equal(statement.gaming.total.playerPnl, '300.00000000');
    assert.equal(statement.gaming.total.agentPnl, '-300.00000000');
    assert.equal(statement.gaming.total.headlineFor, 'AGENT');
    assert.equal(statement.gaming.total.headlinePnl, '-300.00000000');
  });

  await t.test('the screen is given every figure it renders', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * EVERY FIELD BELOW WAS COMPUTED AND THEN DROPPED ON THE FLOOR.
     *
     * `#gatherGaming` summed the turnover, the open stake and the casino
     * staked/won, and counted the bets — then the payload carried only the
     * P&L, because `finaliseGaming` returns signs and nothing else. The
     * report screen renders "312 settled · ₹80,000 staked" beside every
     * headline, so it rendered "undefined settled · — staked" over a
     * correct profit figure, and the per-player and per-agent tables came
     * back blank in six of their nine columns.
     *
     * A payload that is right about the numbers it contains and silent
     * about the ones it does not is still a wrong report. Asserted here so
     * the next person to touch the shape has to mean it.
     * ═══════════════════════════════════════════════════════════════════
     */
    const statement = await service.agentStatement({ staff: asAgent, staffId: agent });
    const { gaming, balance } = statement;

    for (const key of ['settledBets', 'placedBets', 'openBets']) {
      assert.equal(typeof gaming.sports[key], 'number', `gaming.sports.${key}`);
    }
    for (const key of ['turnover', 'openStake', 'playerPnl', 'agentPnl']) {
      assert.equal(typeof gaming.sports[key], 'string', `gaming.sports.${key}`);
    }
    for (const key of ['txns', 'bets', 'wins']) {
      assert.equal(typeof gaming.casino[key], 'number', `gaming.casino.${key}`);
    }
    for (const key of ['staked', 'won', 'playerPnl', 'agentPnl']) {
      assert.equal(typeof gaming.casino[key], 'string', `gaming.casino.${key}`);
    }

    // The two halves of "what did I hand out / take back" the screen totals.
    assert.equal(balance.givenDownline, '1000.00000000');
    assert.equal(balance.collectedDownline, '0.00000000');

    const row = statement.players.find((p) => p.id === String(player));
    assert.equal(row.wallet, '1200.00000000', "the player's own wallet");
    assert.equal(row.funded, '1000.00000000', 'what the tree put in');
    assert.equal(row.collected, '0.00000000');
    assert.equal(row.staffName, `sa-${agent}`, 'the agent the player sits under');
    assert.equal(row.sportsPnl, '300.00000000');
    assert.equal(row.casinoPnl, '0.00000000');

    const self = statement.downline.find((s) => s.id === String(agent));
    assert.equal(self.depth, 0, 'the subject is the root of its own tree');
    assert.equal(self.players, 1);
    assert.equal(self.balance, '5000.00000000', "the sub-agent's own wallet");
    assert.equal(self.wallet, '1200.00000000', "its players' wallets");
    assert.equal(self.funded, '1000.00000000');
    // Agent-facing on this table: the player won 300, so the agent lost it.
    assert.equal(self.sportsPnl, '-300.00000000');
    assert.equal(self.agentPnl, '-300.00000000');
  });

  await t.test('a date range narrows the ledger without moving the wallet', async () => {
    const inside = await service.userStatement({
      staff: asAgent, userId: player, from: '2026-01-05', to: '2026-01-05',
    });

    assert.equal(inside.balance.live, '1200.00000000', 'the wallet is the wallet');
    assert.equal(inside.rows.length, 1, 'only the deposit day');
    assert.equal(inside.rows[0].kind, 'DEPOSIT_UPLINE');
  });

  await t.test("an outsider cannot read the player's statement", async () => {
    await assert.rejects(
      () => service.userStatement({ staff: asOutsider, userId: player }),
      (err) => err.code === 'STATEMENTS_SUBJECT_NOT_FOUND' && err.status === 404
    );
  });

  await t.test("an outsider cannot read the agent's statement", async () => {
    await assert.rejects(
      () => service.agentStatement({ staff: asOutsider, staffId: agent }),
      (err) => err.code === 'STATEMENTS_SUBJECT_NOT_FOUND'
    );
  });

  await t.test('an agent CAN read their own statement', async () => {
    /**
     * Legacy special-cased `staffId !== callerId` because it queried
     * `staff_hierarchy`, whose depth-0 self rows are written only when a staff
     * member is created through the API. Any row seeded directly has no self
     * row — and for those, legacy's `resolvePlayers` would have refused the
     * agent their own bet list.
     */
    const statement = await service.agentStatement({ staff: asAgent, staffId: agent });
    assert.equal(statement.subject.id, String(agent));
  });

  await t.test('the bet lists run against the real tables', async () => {
    const sports = await service.bets({ staff: asAgent, userId: player, kind: 'sports' });
    assert.equal(sports.kind, 'sports');
    assert.ok(Array.isArray(sports.rows));

    const casino = await service.bets({ staff: asAgent, staffId: agent, kind: 'casino' });
    assert.equal(casino.kind, 'casino');
    assert.ok(Array.isArray(casino.rows));
  });

  await t.test('the PDF renders the statement it was given', async () => {
    /**
     * Legacy had two renderers running their OWN queries, and their sports P&L
     * disagreed on any voided or manually adjusted bet — so the download and
     * the screen could show different profit for the same player.
     */
    const statement = await service.userStatement({ staff: asAgent, userId: player });

    const chunks = [];
    const fakeRes = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      write(chunk) { chunks.push(chunk); return true; },
      end() { this.ended = true; },
      on() {},
      once() {},
      emit() {},
      removeListener() {},
    };

    const doc = renderStatement(fakeRes, statement);
    await new Promise((resolve) => doc.on('end', resolve));

    assert.equal(fakeRes.headers['Content-Type'], 'application/pdf');
    assert.match(fakeRes.headers['Content-Disposition'], /statement_user_\d+\.pdf/);

    const pdf = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
    assert.ok(pdf.length > 500, 'a real document came out');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });
});
