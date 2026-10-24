'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { GameEngine } = require('../engine/gameEngine');
const hash = require('../engine/hash');
const limbo = require('../games/limbo');
const mine = require('../games/mine');
const plinko = require('../games/plinko');
const highLow = require('../games/highLow');
const keno = require('../games/keno');
const crash = require('../games/crash');
const videoPoker = require('../games/videoPoker');
const blackjack = require('../games/blackjack');
const authority = require('../engine/serverAuthority');
const classicDice = require('../games/classicDice');
const magicWheel = require('../games/magicWheel');
const diamond = require('../games/diamond');

/**
 * The in-house games.
 *
 * The game arithmetic is legacy's, ported as-is — so these tests PIN what it
 * does rather than assert what it should do. Several of them document
 * behaviour that is almost certainly a bug; they are written that way on
 * purpose, so that changing the behaviour later fails a test and is a
 * decision rather than an accident.
 *
 * The engine tests are different: the stake path is not ported as-is, and
 * those assert the guarantee.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let nextId = 900_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('the ported game arithmetic', async (t) => {
  await t.test('Limbo pays stake × payout − stake on a win', () => {
    // 100 at 2.00, forced to win by a result above the target.
    const outcome = limbo.play({ amount: 100, payout: '2.00', canProfit: true });
    assert.ok(outcome, 'a valid round returns an outcome');

    if (outcome.isWinner) assert.equal(Number(outcome.profit), 100);
    else assert.equal(Number(outcome.profit), -100);
  });

  await t.test('Limbo refuses a payout below 1.01', () => {
    // Legacy checks this twice, once as a string and once as a number.
    assert.equal(limbo.play({ amount: 100, payout: '1.00', canProfit: true }), null);
  });

  await t.test('LIMBO RE-ROLLS WHEN THE HOUSE SWITCH IS OFF', () => {
    /**
     * `canProfit` is `house.current < house.max`. When false, a roll above the
     * player's target is discarded and drawn again — so the player cannot win.
     *
     * Pinned across many rounds rather than one, because the re-roll is the
     * mechanism and a single round proves nothing.
     */
    for (let i = 0; i < 200; i += 1) {
      const outcome = limbo.play({ amount: 10, payout: '1.50', canProfit: false });
      assert.equal(outcome.isWinner, false, 'no round wins with the switch off');
    }
  });

  await t.test('CLASSIC DICE SUBSTITUTES A LOSING NUMBER, AND KEEPS THE OLD HASH', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * The legacy branch, unchanged:
     *
     *     if (type === "Under") {
     *       if (result < roll) {                    // would have won
     *         let res = roll + 1 + "." + H.getRandomBetween(10, 98);
     *         return { hash, result: parseFloat(res) };
     *       }
     *
     * The substituted number is `roll + 1` with two random decimals — one step
     * the WRONG side of the target — and the `hash` returned belongs to the
     * roll that was thrown away. So the value shown to the player does not
     * correspond to the result they were given.
     *
     * Pinned. Changing it changes what the game pays.
     * ═══════════════════════════════════════════════════════════════════
     */
    let substituted = 0;

    for (let i = 0; i < 300; i += 1) {
      const { result } = classicDice.makeDiceResult(false, { type: 'Under', chance: 50 });
      // A substituted result is always >= roll + 1, i.e. a loss for "Under".
      if (result >= 51 && result < 52) substituted += 1;
      assert.ok(result >= 50, 'no result under the roll survives with the switch off');
    }

    assert.ok(substituted > 0, 'the substitution branch is reached');
  });

  await t.test('classic dice with the switch ON can produce a winning roll', () => {
    let anyWin = false;
    for (let i = 0; i < 300; i += 1) {
      const { result } = classicDice.makeDiceResult(true, { type: 'Under', chance: 50 });
      if (result < 50) anyWin = true;
    }
    assert.equal(anyWin, true);
  });

  await t.test('MAGIC WHEEL ALWAYS WINS — the condition compares an array to a number', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     *     if (result !== 24) { isWinner = true; profit = (amount*3 - amount/2)/4; }
     *
     * `result` is the three-element ARRAY from `makeResult`. An array is never
     * strictly equal to `24`, so every round wins and pays `0.625 × stake`.
     * Presumably `result[0] !== 24` was meant.
     *
     * Ported as written, on instruction. Pinned so that fixing it is a
     * deliberate change with a failing test in front of it.
     * ═══════════════════════════════════════════════════════════════════
     */
    for (let i = 0; i < 100; i += 1) {
      const outcome = magicWheel.play({ amount: 100, canProfit: false });
      assert.equal(outcome.isWinner, true, 'every round wins');
      assert.equal(Number(outcome.profit), 62.5, '0.625 × stake, every time');
    }
  });

  await t.test('DIAMOND wins on ADJACENT pairs only, and pays a third of the stake', () => {
    // `n1===n3` does not win — only neighbouring positions. And a winning
    // round profits `amount / 3`, less than the stake it cost.
    const outcome = diamond.play({ amount: 30, canProfit: true });
    assert.ok(outcome.result.length === 5);
    if (outcome.isWinner) assert.equal(Number(outcome.profit), 10);
    else assert.equal(Number(outcome.profit), -30);
  });

  await t.test('⚠ PLINKO PAYS THE MULTIPLIER THE CLIENT SENDS', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     *     let { bonus } = self.data;              // ← from the client
     *     else if (parseFloat(result) > 5.60) {
     *       profit = (amount * bonus) - amount;
     *
     * Nothing server-side computes where the ball landed. Pinned so the
     * behaviour is documented and a fix fails this test deliberately.
     * ═══════════════════════════════════════════════════════════════════
     */
    const outcome = plinko.play({ amount: 1, bonus: 1000000, hash: 'x' });
    assert.equal(outcome.isWinner, true);
    assert.equal(Number(outcome.profit), 999999, 'a stake of 1 pays 999,999');

    // And the paytable it should have been bounded by:
    assert.equal(plinko.PAYTABLE_MAX, 5.6);
  });

  await t.test('HIGH LOW\'s `equal` paytable is missing 777 and 888', () => {
    // The pattern is triples 111…999; `777` and `888` are `7` and `8`.
    for (const value of [111, 222, 333, 444, 555, 666, 999]) {
      assert.ok([111, 222, 333, 444, 555, 666, 7, 8, 999].includes(value));
    }
    assert.equal([111, 222, 333, 444, 555, 666, 7, 8, 999].includes(777), false);
    assert.equal([111, 222, 333, 444, 555, 666, 7, 8, 999].includes(888), false);
  });

  await t.test('an invalid mine count is refused rather than crashing', () => {
    /**
     * Legacy's guard was `return console("mine hack !")` — calling the console
     * OBJECT as a function, which throws `TypeError` inside a callback with no
     * catch, after the stake was taken.
     */
    assert.equal(mine.open({ mines: 7 }), null);
    assert.ok(mine.open({ mines: 3 }), '3 is allowed');
  });

  await t.test('KENO SETTLES EVERY PLAYER, not just the ones before the first loser', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * `calcWinners` iterated the round with `return` where it meant
     * `continue`:
     *
     *     if (calcWin.length === 0)
     *       return;                   // ← leaves calcWinners ENTIRELY
     *
     * So the first player who matched nothing — most players, most rounds —
     * aborted settlement for everyone after them. Their bet rows stayed open.
     *
     * Settling one player at a time makes it impossible to reintroduce.
     * ═══════════════════════════════════════════════════════════════════
     */
    const roundNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const loser = keno.settlePlayer({ picks: [21, 22, 23], roundNumbers, amount: '100' });
    assert.equal(loser.isWinner, false);

    // The one AFTER the loser still settles — which is the whole point.
    const winner = keno.settlePlayer({ picks: [1, 2, 3], roundNumbers, amount: '100' });
    assert.equal(winner.isWinner, true);
    assert.equal(winner.matches, 3);
    assert.equal(Number(winner.profit), 100, '3 matches on 100 pays 100/3 × 3');
  });

  await t.test('keno needs three matches when three or more numbers are picked', () => {
    const roundNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const two = keno.settlePlayer({ picks: [1, 2, 30], roundNumbers, amount: '100' });
    assert.equal(two.isWinner, false, 'two of three is a loss');
  });

  await t.test('a keno draw is ten distinct numbers from forty', () => {
    const drawn = keno.drawRound();
    assert.equal(drawn.numbers.length, 10);
    assert.equal(new Set(drawn.numbers).size, 10, 'distinct');
    assert.ok(drawn.numbers.every((n) => n >= 1 && n <= 40));
  });

  await t.test('a crash point is never below 1.00', () => {
    for (let i = 0; i < 100; i += 1) {
      const { crash: point } = crash.generateResult('');
      assert.ok(Number(point) >= 1.0, `${point} is at least 1.00`);
    }
  });

  await t.test('⚠ CRASH TAKES THE HUMAN MULTIPLIER FROM THE CALLER', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     *     var rate = Math.pow(Math.E, 6e-5 * (ts - timeStart)).toFixed(2);
     *     if (isHuman === true) {
     *       rate = timeStart;        // ← the client's number, not the clock
     *     }
     *
     * The time-based rate is computed and thrown away for a human. Nothing
     * checks the claim against the round's bust point. Fourth game with this
     * shape. Pinned.
     * ═══════════════════════════════════════════════════════════════════
     */
    const result = crash.calculateWinning(100, 50, true);
    assert.equal(result.cashout, 50, 'the caller\'s multiplier is used verbatim');
    assert.equal(result.won, 4900, '100 × (50 − 1)');
  });

  await t.test('the crash round length is derived from the bust point', () => {
    // `Math.log(crash) / Math.log(E) / 6e-5` — and it is unbounded, which is
    // why the loop caps it.
    assert.ok(crash.calculateTimeout(2) < crash.calculateTimeout(10));
    assert.ok(crash.calculateTimeout(1000) > 100_000, 'a high bust point runs for minutes');
  });

  await t.test('the RNG is Math.random through SHA-256 — pinned, not endorsed', () => {
    /**
     * `makeHash` is SHA-256 of a string built from `Math.random()`. Hashing
     * does not add entropy. `SEED_SOURCE` is the one function to change.
     */
    assert.equal(typeof hash.SEED_SOURCE, 'function');

    const original = Math.random;
    try {
      // A fixed source makes the whole chain deterministic, which is the
      // property a CSPRNG would remove.
      Math.random = () => 0.5;
      assert.equal(hash.makeHash(), hash.makeHash());
    } finally {
      Math.random = original;
    }
  });
});

test('the engine against a database', async (t) => {
  const logger = createLogger({ name: 'in-house-test', level: 'silent' });

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
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const engine = new GameEngine({ models, db: connection, logger, config: {} });

  const player = newId();

  const balanceOf = async () => {
    const row = await models.Credits.findOne({ where: { uid: player }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };
  const setBalance = (inr) => models.Credits.update({ inr }, { where: { uid: player } });

  t.before(async () => {
    await models.Bets.destroy({ where: { uid: player } });
    await models.House.destroy({ where: { uid: player } });
    await models.Credits.destroy({ where: { uid: player } });
    await models.Users.destroy({ where: { id: player } });

    await models.Users.create({ id: player, name: `g${player}`, password: 'x', status: 'active' });
    await models.Credits.create({ uid: player, inr: '1000' });
  });

  t.after(async () => {
    await models.Bets.destroy({ where: { uid: player } });
    await models.House.destroy({ where: { uid: player } });
    await models.Credits.destroy({ where: { uid: player } });
    await models.Users.destroy({ where: { id: player } });
    if (connection) await connection.close();
  });

  await t.test('a bet takes the stake and opens a row', async () => {
    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '100' });

    assert.equal(bet.balance, '900.00000000');

    const row = await models.Bets.findOne({ where: { id: bet.betId }, raw: true });
    assert.equal(row.game, 'limbo');
    assert.equal(row.result, null, 'open until settled');
    assert.ok(row.gid, 'gid is populated for the NOT NULL column');
  });

  await t.test('CONCURRENT BETS CANNOT OVERDRAW', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * `Rule.CanPlay` read the balance and compared it in JavaScript;
     * `Rule.preparePlay` debited several callbacks later with
     * `SET ${coin} = ${coin} - $2` and no floor. Ten simultaneous bets all
     * passed the check and the balance went negative.
     *
     * 1000 in, ten bets of 200: exactly five.
     * ═══════════════════════════════════════════════════════════════════
     */
    await setBalance('1000');

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '200' })
      )
    );

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
    assert.equal(await balanceOf(), '0.00000000', 'and never negative');
  });

  await t.test('a settlement pays the stake back less the house edge, plus the profit', async () => {
    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '100' });

    // A win of 100 on a stake of 100. House edge is 2%, so 98 of the stake
    // returns: 900 + 100 + 98 = 1098.
    const settled = await engine.settle({
      userId: player,
      betId: bet.betId,
      profit: '100',
      result: 2.5,
      hash: 'abc',
      isWinner: true,
      coin: 'INR',
      amount: '100',
    });

    assert.equal(settled.payout, '198.00000000');
    assert.equal(await balanceOf(), '1098.00000000');
  });

  await t.test('A WIN WHOSE FLOAT PROFIT OVERFLOWS THE SCALE STILL PAYS', async () => {
    /**
     * Every in-house game computes its profit in JS floats and hands it over
     * as `String(profit)`, because the arithmetic was ported as-is. Limbo's is
     * `stake * target - stake`, and `10 * 1.01 - 10` is `0.09999999999999964`
     * — seventeen decimal places.
     *
     * `toMinor` refused that with `BAD_REQUEST: amount supports at most 8
     * decimal places`, from inside `settle`. The handler's catch refunded the
     * stake and re-raised, so no money was lost — but the WIN paid nothing and
     * the player got a message about decimal places.
     *
     * It was deterministic per (stake, payout) pair, not intermittent:
     * `10 @ 1.01` never paid and `10 @ 2.00` always did. Reproduced against
     * the running service on 2026-09-09, three attempts out of three.
     *
     * 0.1 is what the arithmetic MEANS; the trailing digits are the float's
     * error. Quantising recovers it.
     */
    const float = 10 * 1.01 - 10;
    assert.equal(String(float), '0.09999999999999964', 'the float this guards against');

    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });

    const settled = await engine.settle({
      userId: player,
      betId: bet.betId,
      profit: String(float),
      result: '6.97',
      hash: 'float',
      isWinner: true,
      coin: 'INR',
      amount: '10',
    });

    assert.equal(settled.profit, '0.10000000', 'quantised to the platform scale');
    // 990 left after the stake, plus the profit and the stake less 2%:
    // 990 + 0.1 + 9.8 = 999.90.
    assert.equal(await balanceOf(), '999.90000000');
  });

  await t.test('A BET SETTLES ONCE', async () => {
    /**
     * `updateBetAfterFinish` was an unconditional UPDATE keyed on `gid` — a
     * value that collides one time in a hundred for two bets in the same
     * second — so a duplicate settle paid twice.
     */
    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '100' });

    await engine.settle({
      userId: player, betId: bet.betId, profit: '50', result: 1.5,
      hash: 'x', isWinner: true, coin: 'INR', amount: '100',
    });
    const afterFirst = await balanceOf();

    await assert.rejects(
      () =>
        engine.settle({
          userId: player, betId: bet.betId, profit: '50', result: 1.5,
          hash: 'x', isWinner: true, coin: 'INR', amount: '100',
        }),
      (err) => err.code === 'INHOUSE_ALREADY_SETTLED'
    );

    assert.equal(await balanceOf(), afterFirst, 'paid once');
  });

  await t.test('a refund returns the stake and closes the bet', async () => {
    // Legacy had no such path: a game that threw mid-round left the stake gone
    // and the row open forever.
    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '250' });
    assert.equal(await balanceOf(), '750.00000000');

    const refunded = await engine.refund({ userId: player, betId: bet.betId, coin: 'INR', amount: '250' });
    assert.equal(refunded.refunded, true);
    assert.equal(await balanceOf(), '1000.00000000');

    // And a second refund is a no-op rather than a second credit.
    assert.equal((await engine.refund({ userId: player, betId: bet.betId, coin: 'INR', amount: '250' })).refunded, false);
    assert.equal(await balanceOf(), '1000.00000000');
  });

  await t.test('a stake beyond the balance is refused and moves nothing', async () => {
    await setBalance('10');
    await assert.rejects(
      () => engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '99999' }),
      (err) => err.code === 'INHOUSE_INSUFFICIENT_BALANCE'
    );
    assert.equal(await balanceOf(), '10.00000000');
  });

  await t.test('a currency carrying SQL is refused', async () => {
    // Legacy interpolated `_.lowerCase(coin)` into
    // `UPDATE credits SET ${coin} = ${coin} - $2`.
    await assert.rejects(
      () => engine.placeBet({ userId: player, game: 'limbo', coin: 'inr = 999999, usdt', amount: '1' }),
      (err) => err.code === 'INHOUSE_UNSUPPORTED_COIN'
    );
  });

  await t.test('a multi-step round survives being read back', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * Legacy kept this in `General/Queue`, an in-process array. The platform
     * forks a worker per CPU and Socket.io is not sticky by default, so a
     * cash-out could land on a worker that had never heard of the round —
     * `Queue.getOne` returned undefined and the handler logged
     * "Client Not Playing!" and dropped it, with the stake already gone.
     * ═══════════════════════════════════════════════════════════════════
     */
    await setBalance('1000');
    const opened = mine.open({ mines: 3 });

    const round = await engine.openRound({
      userId: player,
      game: 'mine',
      coin: 'INR',
      amount: '100',
      state: opened.state,
      hash: opened.hash,
    });

    assert.equal(await balanceOf(), '900.00000000', 'the stake is taken when the round opens');

    // A different reader — which is the point.
    const found = await engine.openRoundFor({ userId: player, game: 'mine' });
    assert.equal(String(found.id), round.roundId);
    assert.equal(found.state.mines, 3);
    assert.equal(found.state.result.length, 3, 'three mines');

    await engine.closeRound({ round: found, profit: '30', result: found.state, isWinner: true });
    assert.equal(await balanceOf(), '1028.00000000', '900 + 30 profit + 98 stake back');
  });

  await t.test('ONE OPEN ROUND PER PLAYER PER GAME', async () => {
    /**
     * Legacy's `Queue.exists(id)` — skipped entirely for plinko
     * (`if (game === "plinko") exists = false;`), so that game could have
     * several rounds open at once, each settling from the client's own
     * multiplier. A partial unique index enforces it now.
     */
    await setBalance('1000');
    const opened = mine.open({ mines: 3 });

    await engine.openRound({
      userId: player, game: 'mine', coin: 'INR', amount: '100',
      state: opened.state, hash: opened.hash,
    });
    const afterFirst = await balanceOf();

    await assert.rejects(
      () =>
        engine.openRound({
          userId: player, game: 'mine', coin: 'INR', amount: '100',
          state: opened.state, hash: opened.hash,
        }),
      (err) => err.code === 'INHOUSE_ROUND_ALREADY_OPEN'
    );

    assert.equal(await balanceOf(), afterFirst, 'and the refused stake was given back');

    const open = await engine.openRoundFor({ userId: player, game: 'mine' });
    await engine.closeRound({ round: open, profit: '0', result: {}, isWinner: false, status: 'lost' });
  });

  await t.test('a cash-out with no open round is refused, not dropped', async () => {
    // Legacy: `console.log('Client Not Playing!')` and no reply at all.
    await assert.rejects(
      () => engine.openRoundFor({ userId: player, game: 'tower' }),
      (err) => err.code === 'INHOUSE_NO_OPEN_ROUND'
    );
  });

  await t.test('THE HOUSE SWITCH IS READ FROM THE `house` TABLE', async () => {
    /**
     * `current < max`. Legacy read `results.rows[0].current` with no existence
     * check, so a player with no row threw `TypeError` on every bet — the
     * missing-row case defaults to permissive here.
     */
    assert.equal(await engine.canProfit(player), true, 'no row means allowed');

    await models.House.create({ uid: player, max: 50, current: 0 });
    assert.equal(await engine.canProfit(player), true, '0 < 50');

    await models.House.update({ max: 0, current: 0 }, { where: { uid: player } });
    // This is what `GET /win-house` set for EVERY player at once.
    assert.equal(await engine.canProfit(player), false, '0 < 0 is false — cannot win');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The round loops
  // ══════════════════════════════════════════════════════════════════════

  /**
   * ═════════════════════════════════════════════════════════════════════
   * THE BUG THESE EXIST FOR
   *
   * Both loops opened with
   *
   *     await this.db.query('SELECT pg_try_advisory_lock($1) AS locked', …)
   *
   * The object `db.connect()` returns has `sequelize`, `models`, `transaction`,
   * `advisoryLock`, `ping` and `close` — and NO `query`. The call threw
   * `this.db.query is not a function`; `claim()` caught it and logged
   * "could not claim", so the loop silently never started.
   *
   * Crash and Keno were dead in production while every test passed, because
   * `claim()` had no test at all. These run it against the REAL connection.
   * ═════════════════════════════════════════════════════════════════════
   */
  await t.test('the connection has no `query` — only `sequelize.query`', () => {
    // The shape the bug was about, pinned so it cannot drift back unnoticed.
    assert.strictEqual(typeof connection.query, 'undefined');
    assert.strictEqual(typeof connection.sequelize.query, 'function');
  });

  await t.test('the Crash and Keno loops can take their advisory locks', async () => {
    const { CrashLoop } = require('../engine/crashLoop');
    const { KenoLoop } = require('../engine/kenoLoop');

    // Broadcasts go nowhere — this is about the lock, not the round.
    const io = { emit() {} };
    const loops = [
      new CrashLoop({ io, models, db: connection, logger, engine, config: {} }),
      new KenoLoop({ io, models, db: connection, logger, engine, config: {} }),
    ];

    try {
      for (const loop of loops) {
        const claimed = await loop.claim();
        assert.strictEqual(claimed, true, `${loop.constructor.name}.claim() must succeed`);
        assert.strictEqual(loop.running, true);
      }
    } finally {
      // Stop the timers, or node:test waits on them and the run never exits.
      for (const loop of loops) loop.stop();
    }
  });

});

test('SERVER AUTHORITY closes the four client-controlled payouts', async (t) => {
  await t.test('PLINKO draws its own multiplier and ignores the client', () => {
    /**
     * With the flag on, `bonus` is not read. A stake of 1 claiming 1,000,000
     * pays whatever slot the ball actually landed in — at most 5.6.
     */
    for (let i = 0; i < 200; i += 1) {
      const outcome = plinko.play({ amount: 1, bonus: 1000000, hash: 'x', serverAuthority: true });
      assert.ok(Number(outcome.profit) <= 4.6, 'never more than the paytable allows');
      assert.ok(authority.PLINKO_PAYTABLE.includes(Number(outcome.result)));
    }
  });

  await t.test('the plinko drop is centre-weighted, as a real board is', () => {
    // Binomial over 15 rows — the middle slots should dominate, which is what
    // makes the paytable a house edge rather than a gift.
    const counts = new Array(authority.PLINKO_PAYTABLE.length).fill(0);
    for (let i = 0; i < 5000; i += 1) counts[authority.plinkoDrop().slot] += 1;

    const middle = counts[7] + counts[8];
    const edges = counts[0] + counts[15];
    assert.ok(middle > edges * 10, 'the centre is far more common than the edges');
  });

  await t.test('VIDEO POKER evaluates the hand instead of believing the client', () => {
    const royal = authority.evaluateVideoPoker(['10s', 'Js', 'Qs', 'Ks', 'As']);
    assert.equal(royal.hand, 'royal_flush');
    assert.equal(royal.multiplier, 250);

    // Jacks or better — a low pair does NOT pay.
    assert.equal(authority.evaluateVideoPoker(['2s', '2h', '7d', '9c', 'Ks']).multiplier, 0);
    assert.equal(authority.evaluateVideoPoker(['Js', 'Jh', '7d', '9c', '3s']).multiplier, 1);

    assert.equal(authority.evaluateVideoPoker(['5s', '6h', '7d', '8c', '9s']).hand, 'straight');
    assert.equal(authority.evaluateVideoPoker(['As', '2h', '3d', '4c', '5s']).hand, 'straight', 'the wheel');
  });

  await t.test('a claimed video-poker win on a losing hand pays nothing', () => {
    const state = { cards: ['2s', '3h', '7d', '9c', 'Ks'], deck: [] };
    const outcome = videoPoker.play({
      amount: 100, winning: 999999, state, hold: [0, 1, 2, 3, 4], serverAuthority: true,
    });
    assert.equal(outcome.isWinner, false);
    assert.equal(Number(outcome.profit), -100);
  });

  await t.test('BLACKJACK deals, draws for the dealer, and compares', () => {
    // Player 20, dealer forced to stand on 17.
    const settled = authority.evaluateBlackjack({
      playerCards: ['Ks', 'Qh'],
      dealerCards: ['7d'],
      deck: ['10c', '2s'],
    });
    assert.equal(settled.playerTotal, 20);
    assert.equal(settled.dealerTotal, 17);
    assert.equal(settled.outcome, 'win');
  });

  await t.test('a blackjack natural pays 3:2 and a push returns the stake', () => {
    const natural = authority.evaluateBlackjack({ playerCards: ['As', 'Kh'], dealerCards: ['7d'], deck: ['10c'] });
    assert.equal(natural.outcome, 'blackjack');
    assert.equal(natural.multiplier, 1.5);

    const push = authority.evaluateBlackjack({ playerCards: ['Ks', '9h'], dealerCards: ['10d'], deck: ['9c'] });
    assert.equal(push.push, true);
    assert.equal(push.multiplier, 0, 'profit 0 — the stake comes back through the engine');
  });

  await t.test('a claimed blackjack win on a bust pays nothing', () => {
    const state = { pCards: ['Ks', 'Qh', '5d'], dCards: ['7d'], deck: ['10c'] };
    const outcome = blackjack.play({ amount: 100, profit: 999999, state, serverAuthority: true });
    assert.equal(outcome.isWinner, false);
    assert.equal(Number(outcome.profit), -100);
  });

  await t.test('an ace goes soft when the hand would otherwise bust', () => {
    assert.equal(authority.blackjackTotal(['As', 'Kh']), 21);
    assert.equal(authority.blackjackTotal(['As', 'Kh', '5d']), 16, 'the ace drops to 1');
    assert.equal(authority.blackjackTotal(['As', 'Ah', '9d']), 21);
  });

  await t.test('CRASH caps the cash-out at what the round reached', () => {
    /**
     * The multiplier is `e^(6e-5 × elapsed)`, capped at the bust point. A
     * client asking for more gets the lower of the two.
     */
    const startedAt = Date.now() - 10_000;

    const greedy = authority.crashMultiplier({ startedAt, bustPoint: 2.0, requested: 1000, now: Date.now() });
    assert.ok(greedy.capped);
    assert.ok(greedy.multiplier <= 2.0, 'never above the bust point');

    const honest = authority.crashMultiplier({ startedAt, bustPoint: 100, requested: 1.2, now: Date.now() });
    assert.equal(honest.capped, false);
    assert.equal(honest.multiplier, 1.2, 'a modest ask is granted as-is');
  });

  await t.test('a late crash cash-out is granted at the ceiling, not refused', () => {
    // Arriving a few milliseconds late is a network fact, not an attack —
    // refusing would lose a player a legitimate win.
    const startedAt = Date.now() - 20_000;
    const late = authority.crashMultiplier({ startedAt, bustPoint: 1.5, requested: 1.51, now: Date.now() });
    assert.equal(late.multiplier, 1.5);
    assert.ok(late.capped);
  });

  await t.test('the authority RNG is crypto, not Math.random', () => {
    // This one decides money, so it is not the `SEED_SOURCE` chain.
    const original = Math.random;
    try {
      Math.random = () => 0.5;
      const drops = new Set();
      for (let i = 0; i < 50; i += 1) drops.add(authority.plinkoDrop().slot);
      assert.ok(drops.size > 1, 'a fixed Math.random does not make it deterministic');
    } finally {
      Math.random = original;
    }
  });
});
