'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { LITERAL_EVENTS, AUDIENCE, decode } = require('@ibitplay/socket');

const bonusSockets = require('../sockets');

/**
 * Bonus countdown timers.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `legacy/bonus/bonusengine.js` pushed these from a ONE-SECOND interval that
 * looped every connected socket:
 *
 *     if (io) setInterval(async () => {
 *       for (const s of io.sockets.sockets.values()) {
 *         if (!s.userid) continue;
 *         s.emit('bonusTimerUpdate', await getUserBonusTimers(s.userid));
 *       }
 *     }, 1000);
 *
 * One query per connected player per second, awaited sequentially — so a slow
 * one pushes the loop past its own interval and the ticks pile up. All to
 * render a countdown the client can compute from a timestamp it already has.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 880_500_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('bonus timers', async (t) => {
  const logger = createLogger({ name: 'timers-test', level: 'silent' });

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
  const users = [];

  t.after(async () => {
    if (users.length) {
      await models.BonusHistoryEngine.destroy({ where: { userid: users } });
      await models.Users.destroy({ where: { id: users } });
    }
  });
  t.after(async () => {
    if (connection) await connection.close();
  });

  const registered = new Map();
  bonusSockets.register({ on: (event, spec) => registered.set(event, spec), deps: { models, logger } });
  const handler = registered.get(LITERAL_EVENTS.GET_BONUS_TIMERS);

  const seed = async () => {
    const id = newUid();
    users.push(id);
    await models.Users.create({ id, name: `bt${id}`, password: 'x', status: 'active' });
    return id;
  };

  const addBonus = async (userId, { minutes = 60, claimed = false, unclaimable = false, amount = '5' } = {}) =>
    models.BonusHistoryEngine.create({
      userid: userId,
      bonus_type: 'daily',
      bonus_amount: amount,
      claim_deadline: new Date(Date.now() + minutes * 60_000),
      is_claimed: claimed,
      is_unclaimable: unclaimable,
      created_at: new Date(),
    });

  /** A socket that records what was pushed to it. */
  const makeContext = (userId) => {
    const pushed = [];
    return {
      context: { userId, socket: { emit: (event, payload) => pushed.push({ event, payload }) } },
      pushed,
    };
  };

  // ── The table this reads did not have a model ─────────────────────────

  await t.test('`bonus_history` is a different table from `bonushistory`', async () => {
    /**
     * Two tables one letter apart. The bonus ENGINE writes the underscored one;
     * the rest of the platform uses the other. Only the second had a generated
     * model, which is why `getUserBonusTimers` was raw SQL in legacy.
     */
    // `getTableName()` returns an object, not a string, when a schema is set.
    assert.strictEqual(models.BonusHistoryEngine.tableName, 'bonus_history');
    assert.strictEqual(models.Bonushistory.tableName, 'bonushistory');
  });

  // ── What it returns ───────────────────────────────────────────────────

  await t.test('an active bonus is returned with its deadline and seconds left', async () => {
    const userId = await seed();
    await addBonus(userId, { minutes: 30, amount: '12.5' });

    const { context } = makeContext(userId);
    const result = await handler.handle({}, context);

    assert.strictEqual(result.activeBonuses.length, 1);
    const [bonus] = result.activeBonuses;
    assert.strictEqual(bonus.type, 'daily');
    // Legacy sent `Number(bonus_amount)` — a float for a NUMERIC(30,8).
    assert.strictEqual(bonus.amount, '12.50000000');
    assert.ok(bonus.secondsLeft > 1700 && bonus.secondsLeft <= 1800);
  });

  await t.test('claimed, unclaimable and expired bonuses are excluded', async () => {
    const userId = await seed();
    await addBonus(userId, { minutes: 30 });
    await addBonus(userId, { minutes: 30, claimed: true });
    await addBonus(userId, { minutes: 30, unclaimable: true });
    await addBonus(userId, { minutes: -30 });

    const { context } = makeContext(userId);
    const result = await handler.handle({}, context);

    assert.strictEqual(result.activeBonuses.length, 1, 'only the live one');
  });

  await t.test('a player with nothing pending gets an empty list, not an error', async () => {
    const userId = await seed();
    const { context } = makeContext(userId);

    const result = await handler.handle({}, context);
    assert.deepStrictEqual(result.activeBonuses, []);
    assert.strictEqual(result.userid, String(userId));
  });

  await t.test('only the caller’s own bonuses are returned', async () => {
    const mine = await seed();
    const theirs = await seed();
    await addBonus(theirs, { minutes: 30 });

    const { context } = makeContext(mine);
    const result = await handler.handle({}, context);

    assert.deepStrictEqual(result.activeBonuses, []);
  });

  // ── The reply goes out on the legacy event too ────────────────────────

  await t.test('the reply is pushed on `bonusTimerUpdate` as well as returned', async () => {
    const userId = await seed();
    await addBonus(userId, { minutes: 10 });

    const { context, pushed } = makeContext(userId);
    const result = await handler.handle({}, context);

    /**
     * Legacy answered on a DIFFERENT event from the one it was asked on, and
     * shipped clients listen on that one. The transport also replies on
     * `getBonusTimers`, so both work.
     */
    assert.strictEqual(pushed.length, 1);
    assert.strictEqual(pushed[0].event, LITERAL_EVENTS.BONUS_TIMER_UPDATE);
    assert.deepStrictEqual(decode(pushed[0].payload).activeBonuses.length, result.activeBonuses.length);
  });

  await t.test('the event is player-only and metered', () => {
    assert.strictEqual(handler.audience, AUDIENCE.USER);
    // Legacy's interval pushed at 1 Hz for every connected player at once.
    assert.ok(handler.limit.max <= 60);
  });
});
