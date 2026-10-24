'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { createSocketServer, EVENTS, encode, decode } = require('@ibitplay/socket');

const walletSockets = require('../sockets');

/**
 * Tipping and rain, over a real socket.
 *
 * The point of these is that money moves ATOMICALLY. Legacy's tip was an
 * unlocked read, a compare in JavaScript, and two independent UPDATEs — so
 * concurrent tips overdrew, and a failure between the two destroyed the money.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let nextId = 100_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('tipping and rain', async (t) => {
  const logger = createLogger({ name: 'wallet-socket-test', level: 'silent' });

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

  const sender = newId();
  const target = newId();
  const chatters = [newId(), newId(), newId()];
  const everyone = [sender, target, ...chatters];

  const httpServer = http.createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const tokens = { 'sender-token': String(sender) };
  const socketServer = createSocketServer({
    io,
    authenticate: async (token) => (tokens[token] ? { userId: tokens[token] } : null),
    logger,
    config: {},
  });

  walletSockets.register({ on: socketServer.on, deps: { models, db: connection, logger, config: {} } });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  /**
   * Every client opened, so teardown closes them whatever happened.
   *
   * A `client.close()` written after the assertions is skipped when one fails,
   * and an open socket keeps the process alive — so the run hangs after
   * reporting, which reads as a different failure than it is.
   */
  const clients = [];

  const open = (token) =>
    new Promise((resolve, reject) => {
      const client = connect(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        auth: { token },
        forceNew: true,
      });
      clients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);
    });

  /**
   * Emit and wait for the reply, using the ACK CALLBACK.
   *
   * Not the emit-back form. Ten concurrent requests on one socket would
   * otherwise be ten `client.once` listeners on the same event name, and each
   * reply satisfies whichever listener happens to be first — so a reply cannot
   * be attributed to the request that produced it. The ack is per-request by
   * construction, which is what the concurrency test below needs to mean
   * anything.
   */
  const ask = (client, event, payload) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${event}`)), 5000);
      client.emit(event, encode(payload), (frame) => {
        clearTimeout(timer);
        resolve(decode(frame));
      });
    });

  const balanceOf = async (uid) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  const setBalance = (uid, inr) => models.Credits.update({ inr }, { where: { uid } });

  let client;

  t.before(async () => {
    for (const id of everyone) {
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }

    await models.Users.bulkCreate(everyone.map((id) => ({ id, name: `w${id}`, password: 'x', status: 'active' })));
    await models.Credits.bulkCreate(everyone.map((id) => ({ uid: id, inr: '0' })));

    /**
     * `chat_global` has no `id` column — `sorter` is the NOT NULL numeric it
     * orders on, and it is what the rain recipient query reads.
     */
    await models.ChatGlobal.destroy({ where: { uid: everyone } });
    let sorter = Date.now();
    for (const id of chatters) {
      await models.ChatGlobal.create({
        uid: id,
        name: `w${id}`,
        message: 'hello',
        sorter: (sorter += 1),
        date: new Date(),
      });
    }

    client = await open('sender-token');
  });

  t.after(async () => {
    for (const c of clients) c.close();
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));

    await models.ChatGlobal.destroy({ where: { uid: everyone } });
    for (const id of everyone) {
      await models.CreditsLedger.destroy({ where: { user_id: String(id) } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    if (connection) await connection.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Tipping
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a tip moves money and both sides reconcile', async () => {
    await setBalance(sender, '1000');
    await setBalance(target, '0');

    const reply = await ask(client, EVENTS.SEND_TIP, { target: `w${target}`, amount: '100', coin: 'INR' });

    assert.equal(reply.status, true);
    assert.equal(await balanceOf(sender), '900.00000000');
    assert.equal(await balanceOf(target), '100.00000000');
  });

  await t.test('CONCURRENT TIPS CANNOT OVERDRAW', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * Legacy:
     *
     *     Rule.getClientCoinCredit(id, coin, (senderBalance) => {
     *       if (senderBalance >= amount) {
     *         Rule.reduceBalance(...)   // SET coin = coin - $2, no floor
     *
     * An unlocked read and a compare in JavaScript. Ten simultaneous tips all
     * see the same balance, all pass, and the debit has no floor — so the
     * sender ends up negative and the recipient gains money that never left
     * anywhere.
     *
     * 1000 in, ten tips of 200: exactly five may succeed.
     * ═══════════════════════════════════════════════════════════════════
     */
    await setBalance(sender, '1000');
    await setBalance(target, '0');

    const replies = await Promise.all(
      Array.from({ length: 10 }, () =>
        ask(client, EVENTS.SEND_TIP, { target: `w${target}`, amount: '200', coin: 'INR' })
      )
    );

    const succeeded = replies.filter((r) => r.status === true).length;

    assert.equal(succeeded, 5, 'exactly five of ten');
    assert.equal(await balanceOf(sender), '0.00000000', 'and never negative');
    assert.equal(await balanceOf(target), '1000.00000000', 'every rupee that left arrived');
  });

  await t.test('a tip beyond the balance is refused and moves nothing', async () => {
    await setBalance(sender, '50');
    await setBalance(target, '0');

    const reply = await ask(client, EVENTS.SEND_TIP, { target: `w${target}`, amount: '99999999', coin: 'INR' });

    assert.equal(reply.status, false);
    assert.equal(await balanceOf(sender), '50.00000000');
    assert.equal(await balanceOf(target), '0.00000000', 'and nothing was credited either');
  });

  await t.test('a tip to a name that does not exist is refused', async () => {
    const reply = await ask(client, EVENTS.SEND_TIP, { target: 'no-such-player', amount: '1', coin: 'INR' });
    assert.equal(reply.error.code, 'WALLET_TIP_TARGET_NOT_FOUND');
  });

  await t.test('a tip to yourself is refused', async () => {
    const reply = await ask(client, EVENTS.SEND_TIP, { target: `w${sender}`, amount: '1', coin: 'INR' });
    assert.equal(reply.error.code, 'WALLET_TIP_TO_SELF');
  });

  await t.test('the play-money currency cannot be tipped', async () => {
    // Legacy's `if (coin === "nc")`. `nc` is something the platform prints.
    const reply = await ask(client, EVENTS.SEND_TIP, { target: `w${target}`, amount: '1', coin: 'NC' });
    assert.equal(reply.error.code, 'WALLET_CURRENCY_NOT_TIPPABLE');
  });

  await t.test('an amount below the minimum is refused', async () => {
    /**
     * Legacy's two floors disagreed: the check was `amount <= 0.0000003` and
     * the message said `0.00000050`, so amounts between them were accepted
     * while being told they were not.
     */
    const reply = await ask(client, EVENTS.SEND_TIP, { target: `w${target}`, amount: '0.0000004', coin: 'INR' });
    assert.equal(reply.error.code, 'WALLET_TIP_TOO_SMALL');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Rain
  // ══════════════════════════════════════════════════════════════════════

  await t.test('RAIN WORKS AT ALL — legacy never decoded its payload', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     *     client.on(C.RAIN, (data) => {
     *       let { amount, players, room, coin } = data;
     *
     * The only handler of twenty-five that omits `decode(data)`. All four
     * fields are `undefined`, `_.toNumber` makes the amount `NaN`,
     * `if (amount <= 0)` is false for `NaN`, and `assert(amount >= 0)` throws
     * — an unhandled rejection inside a socket handler, which terminates the
     * process.
     * ═══════════════════════════════════════════════════════════════════
     */
    await setBalance(sender, '1000');
    for (const id of chatters) await setBalance(id, '0');

    const reply = await ask(client, EVENTS.RAIN, { amount: '10', players: 3, room: 'global', coin: 'INR' });

    assert.equal(reply.status, true);
    assert.equal(reply.players, 3);
    assert.equal(reply.each, '10.00000000');

    for (const id of chatters) {
      assert.equal(await balanceOf(id), '10.00000000', `chatter ${id} was paid`);
    }
  });

  await t.test('an unknown room is refused rather than concatenated', async () => {
    // Legacy built `"chat_" + _.lowerCase(room)` from the message.
    const reply = await ask(client, EVENTS.RAIN, {
      amount: '1',
      players: 1,
      room: "'; DROP TABLE users--",
      coin: 'INR',
    });
    assert.equal(reply.error.code, 'WALLET_UNKNOWN_ROOM');
  });

  await t.test('a player count beyond the ceiling is refused', async () => {
    // Legacy had none: `amount * players` with `players` from the message.
    const reply = await ask(client, EVENTS.RAIN, { amount: '1', players: 5000, room: 'global', coin: 'INR' });
    assert.equal(reply.error.code, 'WALLET_RAIN_PLAYER_COUNT');
  });

  await t.test('A PARTIAL RAIN SAYS SO', async () => {
    /**
     * A rain is N separate transfers. If the sender runs out partway, the ones
     * already sent stand — so the reply reports how many landed alongside how
     * many were asked for. Reporting only success would tell the sender a rain
     * of three happened when one did.
     */
    await setBalance(sender, '15');
    for (const id of chatters) await setBalance(id, '0');

    const reply = await ask(client, EVENTS.RAIN, { amount: '10', players: 3, room: 'global', coin: 'INR' });

    assert.equal(reply.status, true);
    assert.equal(reply.requested, 3);
    assert.equal(reply.players, 1, 'only one was affordable');
    assert.equal(await balanceOf(sender), '5.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════

  await t.test('a signed-out socket cannot tip', async () => {
    const stranger = await open('no-such-token');
    const reply = await ask(stranger, EVENTS.SEND_TIP, { target: `w${target}`, amount: '1', coin: 'INR' });
    assert.equal(reply.error.code, 'SOCKET_UNAUTHENTICATED');
  });

  await t.test('the balance read is scoped to the caller', async () => {
    await setBalance(sender, '123.45');
    const reply = await ask(client, EVENTS.CREDIT_COIN, { coin: 'INR' });

    assert.equal(reply.status, true);
    assert.equal(reply.coin, 'INR');
    assert.equal(money.toDecimalString(money.toMinor(reply.value)), '123.45000000');
  });

  // The client indexes this map by the lowercased coin, so an uppercase key is
  // an invisible zero: a funded wallet renders as 0.00 with no error anywhere.
  await t.test('the balance map is keyed by the LOWERCASE coin', async () => {
    await setBalance(sender, '1871.48');
    const reply = await ask(client, EVENTS.CREDIT, {});

    assert.equal(reply.status, true);
    assert.equal(money.toDecimalString(money.toMinor(reply.credit.inr)), '1871.48000000');
    assert.ok(
      Object.keys(reply.credit).every((code) => code === code.toLowerCase()),
      `every key must be lowercase, got ${Object.keys(reply.credit).join(', ')}`
    );
  });
});
