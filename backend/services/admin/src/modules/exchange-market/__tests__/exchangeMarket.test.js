'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Op } = require('sequelize');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { ExchangeMarketService } = require('../exchangeMarket.service');
const { groupByEvent, buildUserBook } = require('../marketBook');

/**
 * Exchange market — Market Analysis, User Book, event bets, Current Bets.
 *
 *   owner ─ agent ─ playerA          direct (parent NULL) = owner ka
 *   other root ─ playerC             agent ko na dikhe (owner = poori site, use dikhe)
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

// ── pure helpers (DB nahi chahiye) ───────────────────────────────────────

test('groupByEvent: event wise, markets by market id, sign ulta (fancy Game Details me as-is)', () => {
  const rows = [
    { match_id: '20', event_id: 'E1', team_name: 'A', exposure_amount: '-100', match_title: 'A v B', game_type: 'MATCH_ODDS' },
    { match_id: '20', event_id: 'E1', team_name: 'B', exposure_amount: '90', match_title: 'A v B', game_type: 'MATCH_ODDS' },
    { match_id: '10', event_id: 'E1', team_name: '6 over run', exposure_amount: '-50', match_title: 'A v B', game_type: 'Normal' },
    { match_id: '20', event_id: 'E1', team_name: 'A', exposure_amount: '-20', match_title: 'A v B', game_type: 'MATCH_ODDS' },
  ];

  const [dash] = groupByEvent(rows, new Map([['E1', { sportId: '4', startTime: null }]]));
  assert.strictEqual(dash.sportId, '4');
  assert.deepStrictEqual(dash.markets.map((m) => m.name), ['Normal', 'MATCH_ODDS']);
  assert.deepStrictEqual(dash.markets.map((m) => m.label), ['Fancy', 'Match Odds']);
  assert.deepStrictEqual(dash.markets[1].rows, [{ label: 'A', value: 120 }, { label: 'B', value: -90 }]);
  assert.deepStrictEqual(dash.markets[0].rows, [{ label: '6 over run', value: 50 }]);

  const [detail] = groupByEvent(rows, new Map(), { fancyAsIs: true });
  assert.deepStrictEqual(detail.markets[0].rows, [{ label: '6 over run', value: -50 }]);
  assert.deepStrictEqual(detail.markets[1].rows[0], { label: 'A', value: 120 });
});

test('buildUserBook: staff rows = neeche ka jod ulta, player apna, viewer pe tree rukta hai', () => {
  const exposures = [
    { user_id: 1, team_name: 'A', exposure_amount: '-100' },
    { user_id: 1, team_name: 'B', exposure_amount: '100' },
    { user_id: 2, team_name: 'A', exposure_amount: '50' },
    { user_id: 2, team_name: 'B', exposure_amount: '-50' },
  ];
  const users = [{ id: 1, name: 'p1', parent_staff_id: 11 }, { id: 2, name: 'p2', parent_staff_id: null }];
  const staff = new Map([[11, { id: 11, name: 'agent', parent_id: 10 }], [10, { id: 10, name: 'owner', parent_id: null }]]);

  const book = buildUserBook(exposures, users, staff, 10);
  assert.deepStrictEqual(book.runners, ['A', 'B']);
  assert.strictEqual(book.tree.length, 2);
  const agent = book.tree.find((n) => n.username === 'agent');
  assert.deepStrictEqual(agent.values, [100, -100]);
  assert.deepStrictEqual(agent.children, [{ id: 'U1', username: 'p1', values: [-100, 100] }]);
  assert.deepStrictEqual(book.tree.find((n) => n.username === 'p2').values, [50, -50]);
});

// ── DB ke saath ──────────────────────────────────────────────────────────

let connection;
const base = 981_000 + (process.pid % 1000) * 10;
const ids = { owner: base + 1, agent: base + 2, otherRoot: base + 3 };
const uidBase = 870_000_000 + (process.pid % 100_000) * 10;
const uids = { a: uidBase + 1, direct: uidBase + 2, c: uidBase + 3 };
const EVENT = `t-ev-${process.pid}`;

test('exchange market service (downline scope)', async (t) => {
  const logger = createLogger({ name: 'exchange-market-test', level: 'silent' });

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
  const q = (sql, replacements) => connection.sequelize.query(sql, { replacements });
  const service = new ExchangeMarketService({ models, logger });

  const ownerRole = 8300 + (process.pid % 40); // 8xxx: sirf exchange tests
  const agentRole = 8350 + (process.pid % 40);
  for (const [id, level] of [[ownerRole, 1], [agentRole, 6]]) {
    await q('INSERT INTO roles (id, name, level) VALUES (:id, :name, :level) ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level', { id, name: `mkt-role-${id}`, level });
  }

  const cleanup = async () => {
    const allUids = Object.values(uids);
    await q('DELETE FROM mssports.user_exposures WHERE user_id IN (:allUids)', { allUids });
    await q('DELETE FROM mssports."SportsBet" WHERE user_id IN (:allUids)', { allUids });
    await q('DELETE FROM mssports.users WHERE user_id IN (:allUids)', { allUids });
    await models.Users.destroy({ where: { id: allUids } });
    const staffIds = Object.values(ids);
    await models.StaffHierarchy.destroy({ where: { [Op.or]: [{ ancestor_id: staffIds }, { descendant_id: staffIds }] } });
    await models.Staff.destroy({ where: { id: [ids.agent] } });
    await models.Staff.destroy({ where: { id: [ids.owner, ids.otherRoot] } });
  };
  await cleanup();
  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  const seedStaff = async (id, roleId, parentId) => {
    await models.Staff.create({ id, name: `mkt-staff-${id}`, email: `mkt-${id}@test.invalid`, password: 'x', role_id: roleId, parent_id: parentId, status: 'active' });
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) rows.push({ ancestor_id: parentId, descendant_id: id, depth: 1 });
    await models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
  };
  await seedStaff(ids.owner, ownerRole, null);
  await seedStaff(ids.agent, agentRole, ids.owner);
  await seedStaff(ids.otherRoot, agentRole, null);

  // SportsBet ka FK mssports.users pe hai (live me bhi player ka mirror row hota hai)
  const seedUser = async (id, parent) => {
    await models.Users.create({ id, name: `mkt-user-${id}`, password: 'x', status: 'active', parent_staff_id: parent });
    await q(`INSERT INTO mssports.users (user_id, username, password, role_id, "createdAt", "updatedAt")
             VALUES (:id, :name, 'x', 1, NOW(), NOW())`, { id, name: `mkt-user-${id}` });
  };
  await seedUser(uids.a, ids.agent);
  await seedUser(uids.direct, null);
  await seedUser(uids.c, ids.otherRoot);

  const expo = (uid, team, amount, gameType = 'MATCH_ODDS') =>
    q(`INSERT INTO mssports.user_exposures (user_id, match_id, event_id, team_name, exposure_amount, match_title, game_type, created_at, updated_at)
       VALUES (:uid, '555', :ev, :team, :amount, 'Team A v Team B', :gameType, NOW(), NOW())`, { uid, ev: EVENT, team, amount, gameType });
  await expo(uids.a, 'Team A', -100);
  await expo(uids.a, 'Team B', 100);
  await expo(uids.a, 'Team Aback', 5); // helper row — kabhi na dikhe
  await expo(uids.direct, 'Team A', 40);
  await expo(uids.direct, 'Team B', -40);
  await expo(uids.c, 'Team A', -999);
  await expo(uids.c, 'Team B', 999);

  const bet = (uid, extra) =>
    q(`INSERT INTO mssports."SportsBet" (user_id, game_type, market_type, bet_type, odds, stake_amount, match_title, selection_name,
          eventid, match_id, sport_id, status, result_status, unmatched, ip_address, created_at, updated_at, match_start_time)
       VALUES (:uid, 'MO', 'MATCH_ODDS', :betType, 2.5, :stake, 'Team A v Team B', 'Team A', :ev, '555', '4', 'open',
          :result, :unmatched, '1.2.3.4', NOW(), NOW(), NOW())`,
    { uid, ev: EVENT, betType: 'back', stake: 100, result: 'pending', unmatched: false, ...extra });
  await bet(uids.a, {});
  await bet(uids.a, { betType: 'lay', stake: 50 });
  await bet(uids.a, { unmatched: true, stake: 30 });
  await bet(uids.a, { result: 'void', stake: 20 });
  await bet(uids.direct, { stake: 70 });
  await bet(uids.c, { stake: 999 });

  const owner = { id: ids.owner, level: 1, canIssueFunds: true };
  const agent = { id: ids.agent, level: 6, canIssueFunds: false };

  await t.test('Market Analysis: owner = poori site + direct users', async () => {
    const { events } = await service.analysis({ actor: owner, eventId: EVENT });
    assert.strictEqual(events.length, 1);
    const [event] = events;
    assert.strictEqual(String(event.sportId), '4');
    assert.ok(event.eventDate);
    // A: −100 + 40 − 999 = −1059 → book +1059 (helper row 'Team Aback' nahi)
    assert.deepStrictEqual(event.markets[0].rows, [{ label: 'Team A', value: 1059 }, { label: 'Team B', value: -1059 }]);
  });

  await t.test('Market Analysis: agent ko sirf apna player', async () => {
    const { events } = await service.analysis({ actor: agent, eventId: EVENT });
    assert.deepStrictEqual(events[0].markets[0].rows, [{ label: 'Team A', value: 100 }, { label: 'Team B', value: -100 }]);
  });

  await t.test('Market Analysis bina eventId: dashboard me ye event bhi hai', async () => {
    const { events } = await service.analysis({ actor: agent });
    assert.ok(events.some((e) => e.eventId === EVENT));
  });

  await t.test('User Book: owner ko agent → player tree, direct user, dusra root', async () => {
    const book = await service.userBook({ actor: owner, eventId: EVENT, gameType: 'MATCH_ODDS' });
    assert.deepStrictEqual(book.runners, ['Team A', 'Team B']);
    const agentNode = book.tree.find((n) => n.id === `S${ids.agent}`);
    assert.deepStrictEqual(agentNode.values, [100, -100]);
    assert.deepStrictEqual(agentNode.children.map((c) => c.id), [`U${uids.a}`]);
    assert.ok(book.tree.some((n) => n.id === `U${uids.direct}`));
    assert.deepStrictEqual(book.tree.find((n) => n.id === `S${ids.otherRoot}`).children.map((c) => c.id), [`U${uids.c}`]);
  });

  await t.test('User Book: agent ke liye player seedha root pe', async () => {
    const book = await service.userBook({ actor: agent, eventId: EVENT });
    assert.deepStrictEqual(book.tree.map((n) => n.id), [`U${uids.a}`]);
  });

  await t.test('Event bets: open + void, sirf downline', async () => {
    const { rows } = await service.eventBets({ actor: agent, eventId: EVENT, limit: 100 });
    assert.strictEqual(rows.length, 4);
    assert.ok(rows.every((r) => r.userId === String(uids.a)));
    assert.strictEqual(rows.filter((r) => r.unmatched).length, 1);
    assert.strictEqual(rows.filter((r) => r.deleted).length, 1);
  });

  await t.test('Current Bets: Matched / Unmatched / Deleted aur Back / Lay', async () => {
    const mine = (r) => r.eventId === EVENT;
    const matched = await service.currentBets({ actor: owner, matchStatus: 'matchbet', betType: 'all', limit: 200, offset: 0 });
    assert.deepStrictEqual(matched.rows.filter(mine).map((r) => Number(r.stake)).sort((x, y) => x - y), [50, 70, 100, 999]);
    assert.strictEqual(matched.rows.find(mine).sportName, 'Cricket');

    const lay = await service.currentBets({ actor: owner, matchStatus: 'matchbet', betType: 'lay', limit: 200, offset: 0 });
    assert.deepStrictEqual(lay.rows.filter(mine).map((r) => Number(r.stake)), [50]);

    const unmatched = await service.currentBets({ actor: agent, matchStatus: 'unsettled', betType: 'all', limit: 200, offset: 0 });
    assert.deepStrictEqual(unmatched.rows.map((r) => Number(r.stake)), [30]);

    const deleted = await service.currentBets({ actor: agent, matchStatus: 'deletebet', betType: 'all', limit: 200, offset: 0 });
    assert.deepStrictEqual(deleted.rows.map((r) => Number(r.stake)), [20]);

    // dusre root ka player kabhi nahi
    const agentAll = await service.currentBets({ actor: agent, matchStatus: 'matchbet', betType: 'all', limit: 1, offset: 0 });
    assert.strictEqual(agentAll.total, 2);
    assert.strictEqual(agentAll.rows.length, 1);
  });

  await t.test('Current Bets: Direct Users | Agent Users tab (channel)', async () => {
    const mine = (r) => r.eventId === EVENT;
    const stakes = async (channel) =>
      (await service.currentBets({ actor: owner, matchStatus: 'matchbet', betType: 'all', channel, limit: 200, offset: 0 })).rows.filter(mine).map((r) => Number(r.stake)).sort((x, y) => x - y);
    assert.deepStrictEqual(await stakes('direct'), [70]);
    assert.deepStrictEqual(await stakes('agent'), [50, 100, 999]);
    assert.deepStrictEqual(await stakes(undefined), [50, 70, 100, 999], 'na bheja = dono');
  });
});
