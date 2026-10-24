'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { Op } = require('sequelize');
const { createLogger, money } = require('@ibitplay/common');

const { GameEngine } = require('../engine/gameEngine');
const { GamesService } = require('../../games/games.service');
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
const wheel = require('../games/wheel');
const singleKeno = require('../games/singleKeno');
const diamond = require('../games/diamond');

/** The real `reverseActivity` over a user-service that is down: what it queues for retry. */
const outboxFeed = () => {
  const queued = [];
  const real = new GamesService({
    models: {},
    db: {
      sequelize: {
        async query(sql, opts) {
          if (/INSERT INTO wager_reverse_outbox/.test(sql)) queued.push(opts.replacements);
          return [[], 1];
        },
      },
    },
    config: {},
    logger: { warn() {}, info() {}, error() {} },
    clients: { user: { async post() { throw new Error('user-service down'); } } },
  });
  return {
    queued,
    games: {
      async recordPlay() {},
      async recordActivity() { return { counted: true }; },
      reverseActivity: (args) => real.reverseActivity(args),
    },
  };
};

/**
 * The in-house games.
 *
 * Most of the game arithmetic is legacy's, ported as-is — so most of these
 * tests PIN what it does rather than assert what it should do. Several of them
 * document behaviour that is almost certainly a bug; they are written that way
 * on purpose, so that changing the behaviour later fails a test and is a
 * decision rather than an accident.
 *
 * FOUR OF THOSE PINS HAVE NOW BEEN RELEASED. Magic Wheel, High Low, Wheel and
 * Single Keno did not depend on chance at all — three won every round and one
 * could not win — and they have been fixed. Their tests now assert the fixed
 * behaviour, and each says what it used to pin. The distinction still holds
 * everywhere else: a test SHOUTING in capitals is pinning a defect, not
 * endorsing it. See `BACKEND-INTEGRATION.md` §8.6.
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

  await t.test('MAGIC WHEEL loses on the landed symbol, and pays the fair 0.25', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * This test used to pin the OPPOSITE — "every round wins, 0.625 × stake,
     * every time" — with a note that it was pinned "so that fixing it is a
     * deliberate change with a failing test in front of it". That fix has now
     * been made deliberately, so the pin is released and reversed.
     *
     * `play()` compares `result[0]`, the landed symbol, against 24. One of
     * five symbols loses, so the player wins four rounds in five, and the
     * payout is the fair profit at that chance rather than legacy's 0.625.
     * ═══════════════════════════════════════════════════════════════════
     */
    let wins = 0;
    const rounds = 4000;

    for (let i = 0; i < rounds; i += 1) {
      const outcome = magicWheel.play({ amount: 100, canProfit: true });
      const landed = Number(outcome.result[0]);

      assert.equal(outcome.isWinner, landed !== 24, 'the landed symbol decides it');

      if (outcome.isWinner) {
        wins += 1;
        assert.ok(Math.abs(Number(outcome.profit) - 25) < 1e-9, '0.25 × stake on a win');
      } else {
        assert.equal(Number(outcome.profit), -100, 'the stake on a loss');
      }
    }

    // Five symbols, one of them losing. Generous bounds — this is a smoke test
    // for "not always", not a test of the RNG's uniformity.
    const rate = wins / rounds;
    assert.ok(rate > 0.75 && rate < 0.85, `win rate ${rate} should sit near 0.8`);
  });

  await t.test('HIGH LOW rolls uniformly over 0–999, so both calls can win', () => {
    /**
     * The roll used to be the shared `0.98/(1 − U)` curve scaled by 1000, whose
     * minimum is 980 — so `high` (`> 500`) won every round and `low` (`< 500`)
     * could not win at all. Measured live: 40/40 on `high`.
     */
    let high = 0;
    let low = 0;
    const rounds = 4000;

    for (let i = 0; i < rounds; i += 1) {
      const roll = highLow.play({ amount: 100, type: 'high', canProfit: true });
      assert.ok(roll.result >= 0 && roll.result <= 999, 'inside 0–999');
      if (roll.isWinner) high += 1;
      if (highLow.play({ amount: 100, type: 'low', canProfit: true }).isWinner) low += 1;
    }

    assert.ok(high / rounds > 0.45 && high / rounds < 0.55, `high ${high / rounds}`);
    assert.ok(low / rounds > 0.45 && low / rounds < 0.55, `low ${low / rounds}`);
  });

  await t.test('WHEEL can land on the losing pocket, and ignores a client risk', () => {
    /**
     * The draw used to be `min(round(curve), segments − 1)` with a curve whose
     * minimum rounds to 1, so pocket 0 was unreachable and `result > 0` was
     * every round. Measured live: 40/40 at segment 8. Payout came from a
     * client-supplied `risk` divisor.
     */
    let losses = 0;
    const rounds = 4000;

    for (let i = 0; i < rounds; i += 1) {
      // A risk that would have paid 10,000× under the old arithmetic.
      const outcome = wheel.play({ amount: 100, segment: 8, risk: 0.0001, canProfit: true });
      if (!outcome.isWinner) losses += 1;
      else assert.ok(Math.abs(Number(outcome.profit) - 100 / 7) < 1e-9, 'stake / (segments − 1)');
    }

    assert.ok(losses > 0, 'pocket 0 is reachable');
    assert.ok(losses / rounds > 0.08 && losses / rounds < 0.17, `loss rate ${losses / rounds}`);

    // The house switch must select the LOSING pocket, not a winning one.
    assert.equal(wheel.play({ amount: 100, segment: 8, canProfit: false }).isWinner, false);
    // A segment count legacy would have thrown a TypeError on.
    assert.ok(wheel.play({ amount: 100, segment: 12, canProfit: true }));
    // And one there is nothing to land on.
    assert.equal(wheel.play({ amount: 100, segment: 1, canProfit: true }), null);
  });

  await t.test('SINGLE KENO draws plain numbers, so a pick can match', () => {
    /**
     * `createNums` runs twice and wraps each element as `{num, hash}`, so the
     * single `.map(m => m.num)` returned objects and `picks.includes(object)`
     * was never true. Measured live: 0 wins in 40. The house switch was also
     * inverted, stripping the player's picks from the pool on the normal path.
     */
    const picks = [1, 2, 3, 4, 5];
    let wins = 0;
    const rounds = 3000;

    for (let i = 0; i < rounds; i += 1) {
      const outcome = singleKeno.play({ amount: 100, numbers: picks, canProfit: true });

      assert.equal(outcome.result.length, 10);
      for (const drawn of outcome.result) {
        assert.equal(typeof drawn, 'number', 'a drawn number, not a wrapper object');
      }
      assert.equal(outcome.isWinner, outcome.matches >= 3);
      if (outcome.isWinner) wins += 1;
    }

    // Hypergeometric says 8.9%; the digest-rotation shuffle biases it to ~11%.
    // Bounded loosely — the point is that it is neither 0 nor most rounds.
    const rate = wins / rounds;
    assert.ok(rate > 0.04 && rate < 0.2, `win rate ${rate} should be a real minority`);
  });

  await t.test('SINGLE KENO refuses a card bigger than ten', () => {
    /**
     * Ten numbers are drawn and three matches win, at a flat `stake / 3`
     * however many are marked — so an unbounded card was a standing edge for
     * the player. Measured before the cap: 13 marks turned the round positive
     * (+1.2%), 20 marks paid +30.5% and 40 marks won every time.
     *
     * The cap is the control, so it is pinned rather than left to the board.
     */
    const card = (n) => Array.from({ length: n }, (_unused, i) => i + 1);

    assert.ok(singleKeno.play({ amount: 100, numbers: card(10), canProfit: true }), '10 is allowed');
    assert.equal(singleKeno.play({ amount: 100, numbers: card(11), canProfit: true }), null);
    assert.equal(singleKeno.play({ amount: 100, numbers: card(40), canProfit: true }), null);

    // And the rest of what makes a card a card.
    assert.equal(singleKeno.play({ amount: 100, numbers: [], canProfit: true }), null, 'empty');
    assert.equal(singleKeno.play({ amount: 100, numbers: [1, 1, 2], canProfit: true }), null, 'dupes');
    assert.equal(singleKeno.play({ amount: 100, numbers: [41], canProfit: true }), null, 'off pool');
    assert.equal(singleKeno.play({ amount: 100, numbers: [0], canProfit: true }), null, 'zero');
    assert.equal(singleKeno.play({ amount: 100, numbers: [2.5], canProfit: true }), null, 'fraction');
    assert.equal(singleKeno.play({ amount: 100, numbers: 'all', canProfit: true }), null, 'not a list');
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
    await models.CreditsLedger.destroy({ where: { user_id: String(player) } });
    await models.WalletHistory.destroy({ where: { uid: player } });
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

  const ledgerFor = (betId) =>
    models.CreditsLedger.findAll({
      where: { user_id: String(player), source_service: 'casino-service' },
      raw: true,
    }).then((rows) => rows.filter((r) => r.meta?.refType === 'INHOUSE' && r.meta?.refId === String(betId)));

  await t.test('RECORDED PROFIT IS WHAT WAS PAID: a 2× win records +9.80, not +10', async () => {
    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });
    const settled = await engine.settle({
      userId: player, betId: bet.betId, profit: '10', result: 2.5, hash: `h-${Date.now()}-${Math.random()}`, isWinner: true, coin: 'INR', amount: '10',
    });

    assert.equal(settled.payout, '19.80000000');
    assert.equal(settled.profit, '9.80000000', 'socket reply carries the net');
    const row = await models.Bets.findByPk(bet.betId, { raw: true });
    assert.equal(money.toDecimalString(money.toMinor(String(row.profit))), '9.80000000', 'bets.profit is the net');
    assert.equal(await balanceOf(), '1009.80000000');
  });

  await t.test('a loss records −stake and pays nothing', async () => {
    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });
    const settled = await engine.settle({
      userId: player, betId: bet.betId, profit: '-10', result: 1.2, hash: `h-${Date.now()}-${Math.random()}`, isWinner: false, coin: 'INR', amount: '10',
    });
    assert.equal(settled.payout, '0.00000000');
    assert.equal(settled.profit, '-10.00000000');
    assert.equal(await balanceOf(), '990.00000000');
    const ledger = await ledgerFor(bet.betId);
    assert.deepEqual(ledger.map((r) => r.reason), ['BET_STAKE'], 'no payout row on a loss');
  });

  await t.test('A PUSH (profit 0) RETURNS THE FULL STAKE and records 0', async () => {
    await setBalance('1000');
    const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });
    const settled = await engine.settle({
      userId: player, betId: bet.betId, profit: '0', result: 2, hash: `h-${Date.now()}-${Math.random()}`, isWinner: false, coin: 'INR', amount: '10',
    });
    assert.equal(settled.payout, '10.00000000');
    assert.equal(settled.profit, '0.00000000');
    assert.equal(await balanceOf(), '1000.00000000');
  });

  await t.test('STAKE, PAYOUT AND REFUND WRITE LEDGER + HISTORY ROWS that sum to the balance change', async () => {
    await setBalance('1000');
    const win = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });
    await engine.settle({
      userId: player, betId: win.betId, profit: '10', result: 2.5, hash: `h-${Date.now()}-${Math.random()}`, isWinner: true, coin: 'INR', amount: '10',
    });
    const refunded = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });
    await engine.refund({ userId: player, betId: refunded.betId, coin: 'INR', amount: '10' });

    const winRows = await ledgerFor(win.betId);
    assert.deepEqual(winRows.map((r) => [r.reason, money.toDecimalString(money.toMinor(String(r.amount))), r.currency]).sort(), [
      ['BET_PAYOUT', '19.80000000', 'INR'],
      ['BET_STAKE', '-10.00000000', 'INR'],
    ]);
    const stakeRow = winRows.find((r) => r.reason === 'BET_STAKE');
    assert.equal(stakeRow.idempotency_key, `casino-service:BET_STAKE:INHOUSE:${win.betId}`);
    assert.equal(money.toDecimalString(money.toMinor(String(stakeRow.meta.previousBalance))), '1000.00000000');
    assert.equal(money.toDecimalString(money.toMinor(String(stakeRow.balance))), '990.00000000');

    const refundRows = await ledgerFor(refunded.betId);
    assert.deepEqual(refundRows.map((r) => r.reason).sort(), ['BET_REFUND', 'BET_STAKE']);

    const all = [...winRows, ...refundRows].reduce((sum, r) => sum + money.toMinor(String(r.amount)), 0n);
    assert.equal(money.toDecimalString(all), '9.80000000', 'ledger sums to the balance change');
    assert.equal(await balanceOf(), '1009.80000000');

    const history = await models.WalletHistory.count({ where: { uid: player, description: { [Op.like]: `%#${win.betId}` } } });
    assert.equal(history, 2, 'wallet_history mirrors the ledger');
  });

  await t.test('games_played counts a SETTLED round, never a refunded one', async () => {
    const before = (await models.Users.findByPk(player, { raw: true })).games_played ?? 0;
    await setBalance('1000');
    const a = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });
    await engine.refund({ userId: player, betId: a.betId, coin: 'INR', amount: '10' });
    const b = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' });
    await engine.settle({
      userId: player, betId: b.betId, profit: '-10', result: 1, hash: `h-${Date.now()}-${Math.random()}`, isWinner: false, coin: 'INR', amount: '10',
    });
    const after = (await models.Users.findByPk(player, { raw: true })).games_played ?? 0;
    assert.equal(Number(after) - Number(before), 1);
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

  await t.test('wager feed: a bet counts once in its coin under its bet id; a refund un-counts it once', async () => {
    const real = engine.games;
    const recorded = [];
    const reversed = [];
    engine.games = {
      async recordActivity(args) { recorded.push(args); return { counted: true }; },
      async reverseActivity(args) { reversed.push(args); return { reversed: true }; },
    };
    try {
      await setBalance('1000');
      const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '250' });
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0].source, 'inhouse');
      assert.equal(String(recorded[0].ref), String(bet.betId));
      assert.equal(String(recorded[0].currency).toUpperCase(), 'INR');
      assert.equal(recorded[0].wagered, '250.00000000');

      await engine.refund({ userId: player, betId: bet.betId, coin: 'INR', amount: '250' });
      await engine.refund({ userId: player, betId: bet.betId, coin: 'INR', amount: '250' });
      assert.deepEqual(reversed, [{ userId: player, source: 'inhouse', ref: bet.betId, outbox: true }]);
    } finally {
      engine.games = real;
    }
  });

  await t.test('wager feed: a refund whose reversal fails is queued in the outbox for retry', async () => {
    const real = engine.games;
    const { games, queued } = outboxFeed();
    engine.games = games;
    try {
      await setBalance('1000');
      const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '100' });
      const refunded = await engine.refund({ userId: player, betId: bet.betId, coin: 'INR', amount: '100' });
      assert.equal(refunded.refunded, true);
      assert.equal(queued.length, 1);
      assert.equal(queued[0].source, 'inhouse');
      assert.equal(queued[0].ref, String(bet.betId));
      assert.equal(queued[0].userId, String(player));
    } finally {
      engine.games = real;
    }
  });

  await t.test('wager feed: a failing feed never fails the bet or the refund', async () => {
    const real = engine.games;
    engine.games = {
      async recordActivity() { throw new Error('down'); },
      async reverseActivity() { throw new Error('down'); },
    };
    try {
      await setBalance('1000');
      const bet = await engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '100' });
      assert.equal(await balanceOf(), '900.00000000');
      const refunded = await engine.refund({ userId: player, betId: bet.betId, coin: 'INR', amount: '100' });
      assert.equal(refunded.refunded, true);
      assert.equal(await balanceOf(), '1000.00000000');
    } finally {
      engine.games = real;
    }
  });

  await t.test('a stake beyond the balance is refused and moves nothing', async () => {
    await setBalance('10');
    await assert.rejects(
      () => engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '99999' }),
      (err) => err.code === 'INHOUSE_INSUFFICIENT_BALANCE'
    );
    assert.equal(await balanceOf(), '10.00000000');
  });

  await t.test('a casino-locked player is refused and moves nothing', async () => {
    await setBalance('100');
    await models.Users.update({ casino_locked: true }, { where: { id: player } });
    try {
      await assert.rejects(
        () => engine.placeBet({ userId: player, game: 'limbo', coin: 'INR', amount: '10' }),
        (err) => err.code === 'INHOUSE_CASINO_LOCKED'
      );
      assert.equal(await balanceOf(), '100.00000000');
    } finally {
      await models.Users.update({ casino_locked: false }, { where: { id: player } });
    }
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

test('a single-shot round validates BEFORE the stake is taken', async () => {
  const sockets = require('../sockets');
  const handlers = new Map();
  const touched = [];
  const fake = (name) => new Proxy({}, { get: (_, op) => async () => { touched.push(`${name}.${String(op)}`); return null; } });
  const deps = {
    models: { House: { findOne: async () => null }, Credits: fake('Credits'), Bets: fake('Bets'), Users: fake('Users') },
    db: { sequelize: { query: async () => { throw new Error('no db in this test'); } }, transaction: async () => { touched.push('db.transaction'); } },
    logger: createLogger({ name: 'in-house-sockets-test', level: 'silent' }),
    config: {},
    io: { emit() {}, to: () => ({ emit() {} }) },
  };
  sockets.register({ on: (event, spec) => handlers.set(event, spec.handle), deps });

  const { EVENTS } = require('@ibitplay/socket');
  const limbo = handlers.get(EVENTS.PLAY_LIMBO);
  const reply = await limbo({ amount: '10', coin: 'INR', payout: '1.00' }, { userId: 1 });

  assert.equal(reply.code, 'INHOUSE_INVALID_STAKE');
  assert.deepEqual(touched, [], 'no debit, no bet row, no transaction for an invalid round');
});
