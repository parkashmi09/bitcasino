'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { BonusService } = require('../bonus.service');
const { vipLevelFor, VIP_LEVELS } = require('@ibitplay/common');

/**
 * Bonuses: the claim, the VIP gate, and the ladder itself.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 940_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const newCode = () => `BON-${process.pid}-${(seq += 1)}`;

test('bonus', async (t) => {
  const logger = createLogger({ name: 'bonus-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The VIP ladder — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the ladder covers every wager without gaps', async () => {
    // A gap between two bands returns undefined and takes the player to VIP 0.
    for (let i = 0; i < VIP_LEVELS.length - 1; i += 1) {
      assert.equal(
        Number(VIP_LEVELS[i + 1].minXp),
        Number(VIP_LEVELS[i].maxXp) + 1,
        `gap between VIP ${VIP_LEVELS[i].level} and VIP ${VIP_LEVELS[i + 1].level}`
      );
    }
  });

  await t.test('a wager above the top band stays at the top — legacy dropped it to zero', async () => {
    // `getVipLevelDetails` returned `{ error: ... }` past 99,999,999,999, and
    // its caller's `parseInt(undefined) || 0` made the platform's biggest
    // player VIP 0 — losing every bonus they qualified for.
    const top = VIP_LEVELS[VIP_LEVELS.length - 1];
    const whale = vipLevelFor('999999999999999');

    assert.equal(whale.level, top.level);
    assert.equal(whale.card, 'diamond');
  });

  await t.test('a player who has never wagered is VIP 0, not VIP 1', async () => {
    assert.equal(vipLevelFor('0').level, 0);
    assert.equal(vipLevelFor('1').level, 1);
  });

  await t.test('band boundaries land on the right side', async () => {
    assert.equal(vipLevelFor('99').level, 1);
    assert.equal(vipLevelFor('100').level, 2);
    assert.equal(vipLevelFor('199').level, 2);
    assert.equal(vipLevelFor('200').level, 3);
  });

  await t.test('a wager with thousands separators parses', async () => {
    // `userwager.wager` is TEXT and holds "1,234,567.89". `Number("1,234")` is
    // NaN, which would make every player VIP 0.
    assert.equal(vipLevelFor('29,000').level, vipLevelFor('29000').level);
    assert.ok(vipLevelFor('29,000').level > 0);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Claims — against a real database
  // ══════════════════════════════════════════════════════════════════════

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new BonusService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service' },
  });

  /** A player at a given VIP level, with a bonus record. */
  const seed = async (uid, { wager = '999999999' } = {}) => {
    await connection.models.BonusClaim.destroy({ where: { userid: uid } });
    await connection.models.Userbonus.destroy({ where: { userid: uid } });
    await connection.models.Userwager.destroy({ where: { uid } });
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });

    await connection.models.Users.create({ id: uid, name: `bonus-${uid}`, password: 'x', status: 'active' });
    await connection.models.Credits.create({ uid, bjb: '0' });
    await connection.models.Userwager.create({ uid, wager });
    await service.createRecord({ userId: uid, name: `bonus-${uid}` });
  };

  const award = async (uid, type, amount, { deadlineDays = 7 } = {}) =>
    connection.models.BonusClaim.create({
      userid: uid,
      bonus_type: type,
      bonus_amount: amount,
      wager_change: '0',
      claim_deadline: new Date(Date.now() + deadlineDays * 86_400_000),
      is_claimed: false,
      is_unclaimable: false,
    });

  const bonusBalance = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.bjb ?? '0'));
  };

  await t.test('two simultaneous claims pay ONCE — legacy paid twice', async () => {
    const uid = newUid();
    await seed(uid);
    await award(uid, 'daily', '50');

    const results = await Promise.allSettled([
      service.claim({ userId: uid, type: 'daily' }),
      service.claim({ userId: uid, type: 'daily' }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await bonusBalance(uid), '50.00000000');

    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1, 'legacy wrote no ledger row at all');
  });

  await t.test('the VIP gate is enforced on the CLAIM, not just the read', async () => {
    // Legacy computed eligibility in `/api/bonuses` and checked nothing in the
    // claim handler, so a player shown "not eligible" could claim anyway.
    const uid = newUid();
    await seed(uid, { wager: '5' }); // VIP 1 — below the daily threshold of 20
    await award(uid, 'daily', '50');

    const view = await service.overview({ userId: uid });
    assert.equal(view.types.daily.eligible, false);
    assert.equal(view.types.daily.claimable, false);

    await assert.rejects(
      () => service.claim({ userId: uid, type: 'daily' }),
      (err) => err.code === 'BONUS_VIP_LEVEL_TOO_LOW' && err.status === 403
    );

    assert.equal(await bonusBalance(uid), '0.00000000');
  });

  await t.test('each bonus type has its own VIP threshold', async () => {
    const uid = newUid();
    // VIP 20 exactly: daily (20) yes, weekly (25) and monthly (30) no.
    await seed(uid, { wager: '29000' });

    const view = await service.overview({ userId: uid });
    assert.equal(view.vip.level, 20);
    assert.equal(view.types.daily.eligible, true);
    assert.equal(view.types.weekly.eligible, false);
    assert.equal(view.types.monthly.eligible, false);
  });

  await t.test('an expired award cannot be claimed', async () => {
    const uid = newUid();
    await seed(uid);
    await award(uid, 'weekly', '100', { deadlineDays: -1 });

    await assert.rejects(
      () => service.claim({ userId: uid, type: 'weekly' }),
      (err) => err.code === 'BONUS_EXPIRED' && err.status === 410
    );
    assert.equal(await bonusBalance(uid), '0.00000000');
  });

  await t.test('an unclaimable award is not offered and cannot be claimed', async () => {
    const uid = newUid();
    await seed(uid);
    await connection.models.BonusClaim.create({
      userid: uid, bonus_type: 'monthly', bonus_amount: '500', wager_change: '0',
      claim_deadline: new Date(Date.now() + 86_400_000), is_claimed: false, is_unclaimable: true,
    });

    const view = await service.overview({ userId: uid });
    assert.equal(view.types.monthly.award, null);

    await assert.rejects(
      () => service.claim({ userId: uid, type: 'monthly' }),
      (err) => err.code === 'BONUS_NOT_CLAIMABLE'
    );
  });

  await t.test('claiming resets the pending figure and accumulates the paid one', async () => {
    const uid = newUid();
    await seed(uid);
    await connection.models.Userbonus.update({ dailybonus: '75' }, { where: { userid: uid } });
    await award(uid, 'daily', '75');

    await service.claim({ userId: uid, type: 'daily' });

    const row = await connection.models.Userbonus.findOne({ where: { userid: uid }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(row.dailybonus)), '0.00000000');
    assert.equal(money.toDecimalString(money.toMinor(row.actualdailybonus)), '75.00000000');
  });

  await t.test('an unknown bonus type is refused', async () => {
    const uid = newUid();
    await seed(uid);
    await assert.rejects(
      () => service.claim({ userId: uid, type: 'yearly' }),
      (err) => err.code === 'BONUS_INVALID_TYPE'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Redeem codes
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a code redeems once, even under concurrency', async () => {
    const uid = newUid();
    await seed(uid);
    const code = newCode();
    await service.createCode({ userId: uid, code, amount: '30' });

    const results = await Promise.allSettled([
      service.redeemCode({ userId: uid, code }),
      service.redeemCode({ userId: uid, code }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await bonusBalance(uid), '30.00000000');
  });

  await t.test('another player cannot redeem your code', async () => {
    const owner = newUid();
    const attacker = newUid();
    await seed(owner);
    await seed(attacker);

    const code = newCode();
    await service.createCode({ userId: owner, code, amount: '30' });

    await assert.rejects(
      () => service.redeemCode({ userId: attacker, code }),
      (err) => err.code === 'BONUS_CODE_NOT_FOUND'
    );
    assert.equal(await bonusBalance(attacker), '0.00000000');
  });

  await t.test('a PERCENTAGE code cannot be redeemed for cash', async () => {
    // Spin-wheel codes carry `bonus_pct` and `amount = 0`. Legacy read `amount`
    // unconditionally, so redeeming one would have paid zero and burned it.
    const uid = newUid();
    await seed(uid);
    const code = newCode();

    await connection.models.Redeembonus.create({
      userid: uid, code, amount: 0, status: 'active',
      bonus_pct: '20', source: 'spinwheel', createdat: new Date(), updatedat: new Date(),
    });

    await assert.rejects(
      () => service.redeemCode({ userId: uid, code }),
      (err) => err.code === 'BONUS_CODE_NOT_ACTIVE'
    );

    const row = await connection.models.Redeembonus.findOne({ where: { code }, raw: true });
    assert.equal(row.status, 'active', 'the code must survive the refusal');
  });

  await t.test('an already-redeemed code is refused', async () => {
    const uid = newUid();
    await seed(uid);
    const code = newCode();
    await service.createCode({ userId: uid, code, amount: '10' });
    await service.redeemCode({ userId: uid, code });

    await assert.rejects(
      () => service.redeemCode({ userId: uid, code }),
      (err) => err.code === 'BONUS_CODE_NOT_ACTIVE'
    );
    assert.equal(await bonusBalance(uid), '10.00000000');
  });

  await t.test('a duplicate code cannot be issued', async () => {
    const uid = newUid();
    await seed(uid);
    const code = newCode();
    await service.createCode({ userId: uid, code, amount: '10' });

    await assert.rejects(
      () => service.createCode({ userId: uid, code, amount: '99' }),
      (err) => err.code === 'BONUS_CODE_EXISTS'
    );
  });
  // ══════════════════════════════════════════════════════════════════════
  //  Per-game counters — the endpoint that mints balance
  // ══════════════════════════════════════════════════════════════════════

  const counters = async (uid) =>
    connection.models.Bonusgame.findOne({ where: { userid: uid }, raw: true });

  await t.test('a second create does not produce a second counter row', async () => {
    // Legacy's `createbonusgame` was a bare INSERT with no conflict handling.
    // Two calls, two rows for one player — and the update then wrote to both
    // while returning one, so the counters became whichever duplicate a later
    // read happened to order first. Migration 020 makes `userid` unique.
    const uid = newUid();
    await seed(uid);

    const first = await service.createBonusGame({ userId: uid, dailybonus: '5' });
    const second = await service.createBonusGame({ userId: uid, dailybonus: '999' });

    assert.equal(first.created, true);
    assert.equal(second.created, false, 'the second call must find the existing row');

    const rows = await connection.models.Bonusgame.count({ where: { userid: uid } });
    assert.equal(rows, 1);
    assert.equal(Number((await counters(uid)).dailybonus), 5, 'the second call must not overwrite');
  });

  await t.test('granting adds to the counters AND pays the total, once', async () => {
    const uid = newUid();
    await seed(uid);
    await service.createBonusGame({ userId: uid });

    const result = await service.grantBonusGame({
      userId: uid,
      idempotencyKey: `grant-${uid}-a`,
      luckyspin: '10',
      depositbonus: '2.5',
    });

    assert.equal(result.granted, '12.50000000');
    assert.equal(result.counters.luckyspin, '10.00000000');
    assert.equal(result.counters.depositbonus, '2.50000000');
    assert.equal(await bonusBalance(uid), '12.50000000');

    // Legacy wrote NO ledger row for this — `UPDATE credits SET bjb = bjb + $1`
    // and nothing else, so the grant appeared on no statement anywhere.
    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1);
  });

  await t.test('a retried grant pays once — legacy paid twice', async () => {
    // The legacy handler was `COALESCE(col,0) + $n` on the counters and
    // `COALESCE(bjb,0) + $total` on the balance, with no replay key of any
    // kind. A client that retried on a timeout was granted twice.
    const uid = newUid();
    await seed(uid);
    await service.createBonusGame({ userId: uid });

    const key = `grant-${uid}-retry`;
    await service.grantBonusGame({ userId: uid, idempotencyKey: key, dailybonus: '40' });
    await service.grantBonusGame({ userId: uid, idempotencyKey: key, dailybonus: '40' });

    assert.equal(await bonusBalance(uid), '40.00000000', 'the retry must not pay again');
    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1);
  });

  await t.test('two simultaneous grants with the same key pay once', async () => {
    const uid = newUid();
    await seed(uid);
    await service.createBonusGame({ userId: uid });

    const key = `grant-${uid}-race`;
    const results = await Promise.allSettled([
      service.grantBonusGame({ userId: uid, idempotencyKey: key, weeklybonus: '25' }),
      service.grantBonusGame({ userId: uid, idempotencyKey: key, weeklybonus: '25' }),
    ]);

    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(await bonusBalance(uid), '25.00000000');
  });

  await t.test('granting into counters that do not exist is refused, not silently ignored', async () => {
    // `increment` against zero rows affects zero rows and reports success. Left
    // unchecked, this would answer 200 having credited the balance from
    // counters that were never touched.
    const uid = newUid();
    await seed(uid);

    await assert.rejects(
      () => service.grantBonusGame({ userId: uid, idempotencyKey: `grant-${uid}-none`, dailybonus: '5' }),
      (err) => err.code === 'BONUS_NO_GAME_COUNTERS' && err.status === 404
    );
    assert.equal(await bonusBalance(uid), '0.00000000');
  });

  await t.test('a grant writes a log entry naming the staff member', async () => {
    const uid = newUid();
    await seed(uid);
    await service.createBonusGame({ userId: uid });

    await service.grantBonusGame({
      userId: uid, idempotencyKey: `grant-${uid}-log`, staffId: 4242, monthlybonus: '7',
    });

    const events = await connection.models.Bonushistory.findAll({ where: { userid: uid }, raw: true });
    assert.equal(events.length, 1, 'legacy left bonushistory untouched on a manual grant');
    assert.match(events[0].event, /monthlybonus/);
    assert.match(events[0].event, /4242/);
  });

  await t.test('deleting the counters leaves the ledger alone', async () => {
    const uid = newUid();
    await seed(uid);
    await service.createBonusGame({ userId: uid });
    await service.grantBonusGame({ userId: uid, idempotencyKey: `grant-${uid}-del`, dailybonus: '15' });

    await service.deleteBonusGame({ userId: uid });

    assert.equal(await counters(uid), null);
    assert.equal(await bonusBalance(uid), '15.00000000', 'money already paid stays paid');
    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1, 'the ledger row is the record — it must survive');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The event log
  // ══════════════════════════════════════════════════════════════════════

  await t.test('editing one log entry leaves the others alone — legacy rewrote all of them', async () => {
    // `UPDATE bonushistory SET event = $1, amount = $2 WHERE userid = $3`.
    // The table is append-only and had no primary key, so "edit the history
    // entry" collapsed a player's whole log into N copies of one line.
    const uid = newUid();
    await seed(uid);

    const a = await service.createEvent({ userId: uid, event: 'daily claim', amount: '5' });
    const b = await service.createEvent({ userId: uid, event: 'weekly claim', amount: '9' });

    await service.updateEvent({ id: b.id, event: 'weekly claim (corrected)', amount: '11' });

    const rows = await connection.models.Bonushistory.findAll({
      where: { userid: uid }, order: [['id', 'ASC']], raw: true,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, a.id);
    assert.equal(rows[0].event, 'daily claim', 'the untouched row must be untouched');
    assert.equal(Number(rows[0].amount), 5);
    assert.equal(rows[1].event, 'weekly claim (corrected)');
    assert.equal(Number(rows[1].amount), 11);
  });

  await t.test('deleting one log entry leaves the others alone', async () => {
    // Legacy: `DELETE FROM bonushistory WHERE userid = $1` — the player's
    // entire history, from a route any holder of the shared player key reached.
    const uid = newUid();
    await seed(uid);

    const a = await service.createEvent({ userId: uid, event: 'keep me', amount: '1' });
    const b = await service.createEvent({ userId: uid, event: 'remove me', amount: '2' });

    await service.deleteEvent({ id: b.id });

    const rows = await connection.models.Bonushistory.findAll({ where: { userid: uid }, raw: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, a.id);
  });

  await t.test('a decimal bonus survives the log — the column was INTEGER', async () => {
    // `bonushistory.amount` was INTEGER, so Postgres rounded on the way in:
    // 0.40 was logged as 0 and 0.60 as 1. Migration 020 widens it, and the
    // model override is what stops Sequelize truncating before it gets there.
    const uid = newUid();
    await seed(uid);

    const row = await service.createEvent({ userId: uid, event: 'rakeback', amount: '0.40' });
    assert.equal(row.amount, '0.40000000');

    const stored = await connection.models.Bonushistory.findByPk(row.id, { raw: true });
    assert.equal(Number(stored.amount), 0.4, 'an INTEGER column would have stored 0');
  });

  await t.test('editing an entry that does not exist is a 404, not a silent no-op', async () => {
    await assert.rejects(
      () => service.updateEvent({ id: 2_147_000_001, event: 'nope' }),
      (err) => err.code === 'BONUS_EVENT_NOT_FOUND' && err.status === 404
    );
  });

  await t.test('the admin dashboard includes a player who has never wagered', async () => {
    // Legacy's two queries were INNER JOINs onto `userwager`, so every player
    // without a wager row — which is everyone who has not played yet — vanished
    // from the screen used to check their bonuses.
    const uid = newUid();
    await seed(uid);
    await connection.models.Userwager.destroy({ where: { uid } });

    const view = await service.adminDashboard({ userId: uid, limit: 200, offset: 0 });
    const found = view.users.find((u) => String(u.userId) === String(uid));

    assert.ok(found, 'a player with no wager row must still appear');
    assert.equal(found.vip.level, 0);
  });

  await t.test('unknown counter names are dropped, not passed into the SQL', async () => {
    // The surviving keys land in an identifier position in `increment`. The
    // validator rejects unknown keys and the service filters them — two gates,
    // because either one being removed later must not open an injection point.
    const uid = newUid();
    await seed(uid);
    await service.createBonusGame({ userId: uid });

    const result = await service.grantBonusGame({
      userId: uid,
      idempotencyKey: `grant-${uid}-inject`,
      dailybonus: '3',
      'bjb" = 999999, "dailybonus': '1',
    });

    assert.equal(result.granted, '3.00000000');
    assert.equal(await bonusBalance(uid), '3.00000000');
  });
});
