'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { BetsService } = require('../bets.service');

/**
 * Placing a bet — the ported legacy handler, against real tables.
 *
 * `bets.service.js` is a verbatim port of
 * `legacy/sportsmain/API/controller.js → placeBet`, so this file's job is to
 * prove the port produces what the original produced: the same exposure map,
 * the same balance movement, the same columns on the row, and the same
 * response body — including the parts that are wrong on purpose, because
 * settlement and the admin reports read them.
 *
 * The two deliberate departures are asserted too:
 *   - `user_id` comes from the token, never the body
 *   - the debit, the bet row and the exposures are one transaction
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 880_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const GMID = 659_400_000 + (process.pid % 1000);
const MID = 7_614_200_000_000 + (process.pid % 1000);
const MATCH_ID = String(MID);

test('sports bets — the ported place-bet handler', async (t) => {
  const logger = createLogger({ name: 'bets-test', level: 'silent' });

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
      service: 'sports-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  /**
   * The book the `feed:odds` job caches under `oddsData:<gmid>`.
   *
   * This is what the guard reads, and it is the ONLY thing standing between
   * `odds` — a request-body field — and a payout. India 2.5/2.6, Australia
   * 3.0/3.1, The Draw 5.0/5.2.
   */
  const BOOK = [
    {
      gmid: GMID,
      mid: MID,
      mname: 'MATCH_ODDS',
      gtype: 'match',
      status: 'OPEN',
      section: [
        { sid: 1, nat: 'India', gstatus: 'OPEN', odds: [
          { odds: 2.5, oname: 'back1', otype: 'back', size: 1000 },
          { odds: 2.6, oname: 'lay1', otype: 'lay', size: 1000 }] },
        { sid: 2, nat: 'Australia', gstatus: 'OPEN', odds: [
          { odds: 3.0, oname: 'back1', otype: 'back', size: 1000 },
          { odds: 3.1, oname: 'lay1', otype: 'lay', size: 1000 }] },
        { sid: 3, nat: 'The Draw', gstatus: 'OPEN', odds: [
          { odds: 5.0, oname: 'back1', otype: 'back', size: 1000 },
          { odds: 5.2, oname: 'lay1', otype: 'lay', size: 1000 }] },
      ],
    },
  ];

  const makeCache = (book = BOOK) => ({
    async get(key) {
      return key === `oddsData:${GMID}` && book ? JSON.stringify(book) : null;
    },
  });

  const build = ({ cache, clients } = {}) =>
    new BetsService({
      models: connection.models,
      db: connection,
      cache: cache ?? makeCache(),
      logger,
      config: { SERVICE_NAME: 'sports-service' },
      clients: clients ?? { admin: { get: async () => ({ data: { locked: false } }) } },
    });

  /**
   * `users.parent_staff_id` has a foreign key to `staff`, so a fixture that
   * exercises the staff-tree lock has to have a staff row to point at.
   *
   * Raw SQL on purpose: `staff` is in the ADMIN model domain and
   * sports-service loads `sports`, `core` and `extended`, so
   * `connection.models.Staff` is undefined here — which is the ownership
   * boundary doing its job, and the reason the port calls admin-service for
   * the upline walk instead of looping over the table as legacy did.
   */
  const ensureStaff = async (staffId) => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level)
       VALUES (:roleId, :roleName, 3)
       ON CONFLICT (id) DO NOTHING`,
      { replacements: { roleId: 9000 + staffId, roleName: `bet-test-role-${staffId}` } }
    );
    await connection.sequelize.query(
      `INSERT INTO staff (id, name, email, password, role_id)
       VALUES (:id, :name, :email, 'x', :roleId)
       ON CONFLICT (id) DO NOTHING`,
      {
        replacements: {
          id: staffId,
          name: `bet-staff-${staffId}`,
          email: `bet-staff-${staffId}@test.invalid`,
          roleId: 9000 + staffId,
        },
      }
    );
    return staffId;
  };

  const seed = async (uid, { inr = '1000', sportsLocked = false, parentStaffId = null } = {}) => {
    if (parentStaffId) await ensureStaff(parentStaffId);
    await connection.models.UserExposures.destroy({ where: { user_id: String(uid) } });
    await connection.models.SportsBet.destroy({ where: { user_id: String(uid) } });
    await connection.models.Credits.destroy({ where: { uid: String(uid) } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid,
      name: `bet-${uid}`,
      password: 'x',
      status: 'active',
      sports_betlocked: sportsLocked,
      parent_staff_id: parentStaffId,
    });
    await connection.models.Credits.create({ uid: String(uid), inr });
    return uid;
  };

  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid: String(uid) }, raw: true });
    return Number(row.inr);
  };

  /** The payload the board posts, exactly as it posts it. */
  const bet = (overrides = {}) => ({
    game_type: 'MATCH',
    market_type: 'MATCH_ODDS',
    mname: 'MATCH_ODDS',
    gtype: 'match',
    match_id: MATCH_ID,
    market_id: MID,
    eventid: String(GMID),
    sid: '4',
    selection_name: 'India',
    nat: 'India',
    bet_type: 'back',
    odds: 2.5,
    stake_amount: 100,
    match_title: 'India v Australia',
    event_name: 'India v Australia',
    team_one: 'India',
    team_two: 'Australia',
    runners: ['India', 'Australia', 'The Draw'],
    count: 2,
    category: '0',
    fancy_name: '',
    original_currency: 'INR',
    original_amount: 100,
    usd_amount: 1.18,
    size: 0,
    unmatched: false,
    unmatched_odds: null,
    ip_address: '203.0.113.9',
    ...overrides,
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The happy path
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a bet blocks the worst case and answers the legacy body', async () => {
    const uid = await seed(newUid());
    const service = build();

    const { status, body } = await service.place({ ...bet(), user_id: uid });

    assert.equal(status, 200);
    assert.equal(body.success, true);
    // back 100 @ 2.5 ⇒ India +150, everyone else −100. Worst case 100.
    assert.deepEqual(body.exposure[MATCH_ID].teams, {
      India: 150, Australia: -100, 'The Draw': -100,
    });
    assert.equal(body.oldBalance, 1000);
    assert.equal(body.newBalance, 900);
    assert.equal(body.balanceDelta, -100);
    assert.equal(body.totalExposure, 200, 'both losing outcomes, summed per match');

    assert.equal(await balanceOf(uid), 900, 'credits.inr moved');

    const rows = await connection.models.SportsBet.findAll({ where: { user_id: String(uid) }, raw: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].selection_name, 'India');
    assert.equal(rows[0].status, 'open');
    assert.equal(rows[0].game_type, 'MO');
    assert.equal(Number(rows[0].liability), 100, 'back ⇒ liability = stake');
    assert.equal(Number(rows[0].exposure_after_bet), 100);
    assert.equal(rows[0].counts, 3, '`count` is overwritten by runners.length');
  });

  await t.test('the draw leg is present because runners.length is 3', async () => {
    /**
     * Legacy's `count` arrived in the BODY and then line 133 overwrote it with
     * `runners?.length` — so the `count == 3` test that decides the Draw leg
     * reads the runner list, not the caller's number. The payload above says
     * `count: 2`; the Draw is still there.
     *
     * That only holds because the board sends `runners`. A payload with no
     * `runners` makes `count` undefined, and on the MO branch
     * `calculateRunnerExposure` then iterates nothing — see the next test.
     */
    const uid = await seed(newUid());
    const { body } = await build().place({ ...bet({ count: 2 }), user_id: uid });
    assert.equal(body.exposure[MATCH_ID].teams['The Draw'], -100);
  });

  await t.test('a match-odds bet with no runners list throws, and writes nothing', async () => {
    /**
     * Carried across from legacy unchanged, and worth stating out loud: the MO
     * branch is `for (const runner of runners)` over a field that arrives in
     * the REQUEST, so an absent list is a `TypeError: runners is not iterable`
     * — which legacy's catch turned into `400 {success:false, message:"runners
     * is not iterable"}`, and this controller does the same.
     *
     * The board always sends the list, so this is the shape of the failure
     * when something else calls the endpoint, not a live path.
     */
    const uid = await seed(newUid());

    await assert.rejects(
      () => build().place({ ...bet({ runners: undefined }), user_id: uid }),
      /runners is not iterable/
    );

    assert.equal(await balanceOf(uid), 1000, 'the transaction rolled back');
    assert.equal(await connection.models.SportsBet.count({ where: { user_id: String(uid) } }), 0);
  });

  await t.test('the exposure written matches the exposure returned', async () => {
    const uid = await seed(newUid());
    const { body } = await build().place({ ...bet(), user_id: uid });

    const rows = await connection.models.UserExposures.findAll({
      where: { user_id: String(uid) },
      raw: true,
    });
    const stored = Object.fromEntries(rows.map((r) => [r.team_name, Number(r.exposure_amount)]));

    assert.deepEqual(stored, body.exposure[MATCH_ID].teams);
    assert.equal(rows[0].game_type, 'MATCH_ODDS', 'keyed by market_type, as legacy keyed it');
  });

  await t.test('a second bet on the same match blocks only the DIFFERENCE', async () => {
    const uid = await seed(newUid());
    const service = build();

    await service.place({ ...bet(), user_id: uid });
    assert.equal(await balanceOf(uid), 900);

    // Backing Australia too: the worst case is now the draw, losing both
    // stakes — 200 — so only another 100 is blocked.
    const { body } = await service.place({
      ...bet({ selection_name: 'Australia', nat: 'Australia', odds: 3.0 }),
      user_id: uid,
    });

    assert.equal(body.balanceDelta, -100);
    assert.equal(await balanceOf(uid), 800);
    assert.equal(body.exposure[MATCH_ID].teams['The Draw'], -200);
  });

  await t.test('a hedge RELEASES money rather than taking more', async () => {
    const uid = await seed(newUid());
    const service = build();

    await service.place({ ...bet(), user_id: uid });
    // Laying India back off: India 150 − 100×1.6 = −10, the others −100 + 100 = 0.
    const { body } = await service.place({
      ...bet({ bet_type: 'lay', odds: 2.6 }),
      user_id: uid,
    });

    assert.ok(body.balanceDelta > 0, 'money came back');
    assert.equal(await balanceOf(uid), 1000 - 100 + body.balanceDelta);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Refusals
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a price the book never offered is refused by the guard', async () => {
    /**
     * The single largest hole in the legacy platform, and the guard is the
     * whole of the defence: `odds` is still a body field, so if
     * `oddsData:<gmid>` is cold — or `BET_GUARD_ALLOW_ON_MISS=true` — nothing
     * checks it at all.
     */
    const uid = await seed(newUid());
    const { status, body } = await build().place({ ...bet({ odds: 1000 }), user_id: uid });

    assert.equal(status, 403);
    assert.equal(body.code, 'ODDS_CHANGED');
    assert.equal(await balanceOf(uid), 1000, 'no money moved');
    assert.equal(await connection.models.SportsBet.count({ where: { user_id: String(uid) } }), 0);
  });

  await t.test('a suspended market is refused', async () => {
    const uid = await seed(newUid());
    const suspended = [{ ...BOOK[0], status: 'SUSPENDED' }];
    const { status, body } = await build({ cache: makeCache(suspended) })
      .place({ ...bet(), user_id: uid });

    assert.equal(status, 403);
    assert.equal(body.code, 'MARKET_SUSPENDED');
  });

  await t.test('a cold odds cache refuses the bet — it fails CLOSED', async () => {
    const uid = await seed(newUid());
    const { status, body } = await build({ cache: makeCache(null) })
      .place({ ...bet(), user_id: uid });

    assert.equal(status, 403);
    assert.equal(body.code, 'ODDS_UNAVAILABLE');
    assert.equal(await balanceOf(uid), 1000);
  });

  await t.test('a selection the book does not have is refused', async () => {
    const uid = await seed(newUid());
    const { status, body } = await build()
      .place({ ...bet({ selection_name: 'Nobody', nat: 'Nobody' }), user_id: uid });

    assert.equal(status, 403);
    assert.equal(body.code, 'SELECTION_NOT_FOUND');
  });

  await t.test('a locked account cannot bet, and no money moves', async () => {
    const uid = await seed(newUid(), { sportsLocked: true });
    const { status, body } = await build().place({ ...bet(), user_id: uid });

    assert.equal(status, 403);
    assert.equal(body.message, 'Betting is locked for your account.');
    assert.equal(await balanceOf(uid), 1000);
  });

  await t.test('a lock anywhere up the staff tree stops the bet', async () => {
    const uid = await seed(newUid(), { parentStaffId: 5 });
    const service = build({ clients: { admin: { get: async () => ({ data: { locked: true } }) } } });

    const { status, body } = await service.place({ ...bet(), user_id: uid });
    assert.equal(status, 403);
    assert.equal(body.message, 'Betting is locked by your upline.');
  });

  await t.test('an unreachable lock check refuses the bet — it fails CLOSED', async () => {
    /**
     * The opposite direction from the sports feature flag, deliberately. That
     * one gates a READ and fails open so an unrelated outage does not take the
     * board down. This gates money, so an unavailable answer is a refusal.
     */
    const uid = await seed(newUid(), { parentStaffId: 5 });
    const service = build({
      clients: { admin: { get: async () => { throw new Error('admin-service down'); } } },
    });

    const { status } = await service.place({ ...bet(), user_id: uid });
    assert.equal(status, 403);
    assert.equal(await balanceOf(uid), 1000);
  });

  await t.test('a bet larger than the balance is refused and writes nothing', async () => {
    const uid = await seed(newUid(), { inr: '50' });
    const service = build();

    await assert.rejects(
      () => service.place({ ...bet(), user_id: uid }),
      /Insufficient balance/
    );

    assert.equal(await balanceOf(uid), 50, 'the balance is untouched');
    assert.equal(await connection.models.SportsBet.count({ where: { user_id: String(uid) } }), 0);
    assert.equal(await connection.models.UserExposures.count({ where: { user_id: String(uid) } }), 0);
  });

  await t.test('a player with no credits row is refused', async () => {
    const uid = await seed(newUid());
    await connection.models.Credits.destroy({ where: { uid: String(uid) } });

    await assert.rejects(() => build().place({ ...bet(), user_id: uid }), /Wallet not found/);
  });

  await t.test('an unknown player is refused', async () => {
    const { status, body } = await build().place({ ...bet(), user_id: 1 });
    assert.equal(status, 400);
    assert.equal(body.message, 'User not found');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The bet row, exactly as legacy wrote it
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the row carries legacy\'s columns, quirks and all', async () => {
    const uid = await seed(newUid());
    await build().place({ ...bet(), user_id: uid });

    const row = await connection.models.SportsBet.findOne({ where: { user_id: String(uid) }, raw: true });

    // `category + "1"` — string concatenation, legacy controller.js:1935. A
    // payload `category: "0"` is stored as "01". Preserved because the admin
    // reports group on it.
    assert.equal(row.category, '01');

    assert.equal(row.game_type, 'MO', 'normGameType, not the body\'s "MATCH"');
    assert.equal(row.market_type, 'MATCH_ODDS');
    assert.equal(row.bet_type, 'back');
    assert.equal(Number(row.odds), 2.5);
    assert.equal(Number(row.stake_amount), 100);
    assert.equal(row.size, 0, 'zeroed for anything not in marketsforfancy');
    assert.equal(row.fixed, 0);
    assert.equal(row.fancy_name, 'NULL', 'the STRING "NULL", as legacy wrote it');
    assert.equal(row.eventid, String(GMID));
    assert.equal(row.sport_id, '4');
    assert.deepEqual(row.runners, ['India', 'Australia', 'The Draw']);
    assert.equal(row.unmatched, false);
    assert.equal(Number(row.usd_amount), 1.18);
    assert.ok(row.match_start_time, 'defaulted to now when the body omits it');
  });

  await t.test('a fancy bet stores yes/no rather than back/lay', async () => {
    const uid = await seed(newUid());
    const fancyBook = [{
      gmid: GMID, mid: MID, mname: 'Normal', gtype: 'fancy', status: 'OPEN',
      section: [{ sid: 9, nat: '6 over runs', gstatus: 'OPEN', odds: [
        { odds: 100, oname: 'back1', otype: 'back', size: 52 },
        { odds: 100, oname: 'lay1', otype: 'lay', size: 50 }] }],
    }];

    const { status, body } = await build({ cache: makeCache(fancyBook) }).place({
      ...bet({
        game_type: 'FANCY', market_type: 'Normal', mname: 'Normal', gtype: 'fancy',
        selection_name: '6 over runs', nat: '6 over runs',
        bet_type: 'back', odds: 100, back_size: 52, lay_size: 50, size: 52,
        runners: undefined,
      }),
      user_id: uid,
    });

    assert.equal(status, 200, JSON.stringify(body));
    const row = await connection.models.SportsBet.findOne({ where: { user_id: String(uid) }, raw: true });
    assert.equal(row.bet_type, 'yes', 'FAN converts back → yes');
    assert.equal(row.game_type, 'FAN');
    assert.equal(row.size, 52, 'and size SURVIVES on a fancy market');

    // The lay/back side-books legacy keeps per selection.
    assert.ok('6 over runslay' in body.exposure[MATCH_ID].teams);
    assert.ok('6 over runsback' in body.exposure[MATCH_ID].teams);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a player reads their own bets, not their neighbour\'s', async () => {
    const mine = await seed(newUid());
    const theirs = await seed(newUid());
    const service = build();

    await service.place({ ...bet(), user_id: mine });
    await service.place({ ...bet(), user_id: theirs });

    const history = await service.history({ userId: mine });
    assert.equal(history.total, 1, 'one bet, not two');
  });

  await t.test('a player\'s own bet list does not carry their IP address', async () => {
    // It is on the row for fraud review. Staff see it; the player does not.
    const uid = await seed(newUid());
    const service = build();
    await service.place({ ...bet(), user_id: uid });

    const history = await service.history({ userId: uid });
    assert.equal(history.rows[0].ipAddress, undefined);

    const stored = await connection.models.SportsBet.findOne({ where: { user_id: String(uid) }, raw: true });
    assert.equal(stored.ip_address, '203.0.113.9', 'but it IS recorded');
  });

  await t.test('exposures report the liability, not just the raw numbers', async () => {
    const uid = await seed(newUid());
    const service = build();
    await service.place({ ...bet(), user_id: uid });

    const [position] = await service.exposures({ userId: uid });
    assert.equal(position.liability, '100.00000000');
    assert.equal(position.matchId, MATCH_ID);
  });

  await t.test('open bets and the open count see the same rows', async () => {
    const uid = await seed(newUid());
    const service = build();
    await service.place({ ...bet(), user_id: uid });

    const open = await service.openBets({ userId: uid, matchId: MATCH_ID });
    assert.equal(open.length, 1);
    assert.equal(open[0].selection, 'India');

    const counted = await service.openCount({ userId: uid });
    assert.equal(counted.total, 1);
    assert.equal(counted.byMatch[0].matchId, MATCH_ID);
  });
});
