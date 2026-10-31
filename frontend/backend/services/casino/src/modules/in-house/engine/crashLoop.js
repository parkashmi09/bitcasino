'use strict';

const { EVENTS, encode } = require('@ibitplay/socket');
const { money } = require('@ibitplay/common');

const crash = require('../games/crash');
const { crashMultiplier } = require('./serverAuthority');
const { WAITING_MS, BUSTED_MS, MAX_ROUND_MS } = require('../inHouse.constants');

/**
 * The Crash round loop.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS THE ONE GAME THAT IS NOT A REQUEST
 *
 * Crash is a shared round: the server draws a bust point, broadcasts a rising
 * multiplier to everyone at once, and each player cashes out against it. So it
 * is a scheduler with a broadcast, not a socket handler — legacy's shape:
 *
 *     wait  → H.wait(5000)          → start
 *     start → H.wait(crashTimeout)  → bust
 *     bust  → H.wait(5000)          → wait
 *
 * Three `setTimeout` chains and a module-level `status`, `hash`, `gameID` and
 * `bustedNumber`.
 *
 * ── WHAT THAT COSTS UNDER `cluster` ──────────────────────────────────────
 *
 * `legacy/index.js` forks a worker per CPU. Every worker runs its own copy of
 * this loop, with its own bust point, its own timers and its own `gameID` — so
 * on an 8-core box there are EIGHT different Crash games running, and which one
 * a player sees depends on which worker their socket landed on. Two players
 * watching "the same" round are watching different numbers.
 *
 * The loop here is a singleton guarded by an advisory lock, so exactly one
 * process runs it however many are deployed. A worker that does not hold the
 * lock serves the sockets and relays what the holder broadcasts.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** Postgres advisory lock id for the crash loop. Arbitrary but fixed. */
const LOOP_LOCK_ID = 918_273_641;

class CrashLoop {
  constructor({ io, models, db, logger, engine, config }) {
    this.io = io;
    /**
     * With `INHOUSE_SERVER_AUTHORITY=true` the cash-out multiplier is computed
     * from elapsed time and capped at the bust point, instead of being taken
     * from the client. See `serverAuthority.js`.
     */
    this.serverAuthority = config?.INHOUSE_SERVER_AUTHORITY === true || config?.INHOUSE_SERVER_AUTHORITY === 'true';
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.engine = engine;

    /** waiting | started | busted */
    this.status = 'busted';
    this.hash = '';
    this.bustPoint = null;
    this.roundId = null;
    this.startedAt = null;
    /** userId -> { betId, amount, coin, cashedOut } */
    this.players = new Map();

    this.timer = null;
    this.running = false;
  }

  /**
   * Take the loop, if nobody else has it.
   *
   * A Postgres advisory lock rather than a flag: it is released automatically
   * when the connection drops, so a worker that dies mid-round does not leave
   * the loop permanently claimed.
   */
  async claim() {
    /**
     * `this.db.sequelize.query`, not `this.db.query`.
     *
     * The connection object from `db.connect()` exposes `sequelize`, `models`,
     * `transaction`, `advisoryLock`, `ping` and `close` — there is no `query`
     * on it. Calling one threw `this.db.query is not a function`, which
     * `claim()` caught and logged as "could not claim", so the loop silently
     * never started and the game was dead in production while every unit test
     * passed against a stub that did have `.query`.
     */
    const [[row]] = await this.db.sequelize.query('SELECT pg_try_advisory_lock($1) AS locked', {
      bind: [LOOP_LOCK_ID],
    });

    if (!row?.locked) {
      this.logger?.info('Crash loop is running elsewhere — this process will relay only');
      return false;
    }

    this.logger?.info('Crash loop claimed');
    this.running = true;
    this.#wait();
    return true;
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** `wait` — betting is open. */
  #wait() {
    if (!this.running) return;

    this.status = 'waiting';
    this.hash = crash.generateResult(this.hash).hash;
    this.players.clear();
    this.roundId = null;

    this.io.emit(EVENTS.WAITING_CRASH, encode({ status: 'waiting', hash: this.hash, waitMs: WAITING_MS }));

    this.timer = setTimeout(() => this.#start(), WAITING_MS);
  }

  /** `start` — the multiplier is rising. */
  #start() {
    if (!this.running) return;

    const drawn = crash.generateResult(this.hash);
    this.hash = drawn.hash;
    this.bustPoint = drawn.crash;
    this.status = 'started';
    this.startedAt = Date.now();

    /**
     * How long the round runs. `calculateTimeout` is unbounded — a bust point
     * of 1000 is about 115 seconds, and the distribution has no ceiling, so a
     * rare draw could run for hours. Legacy had no cap; one here, because a
     * round that never ends is a stake nobody gets back.
     */
    const duration = Math.min(crash.calculateTimeout(Number(this.bustPoint)), MAX_ROUND_MS);

    this.io.emit(EVENTS.STATUS_CRASH, encode({ status: 'started', startedAt: this.startedAt }));

    this.timer = setTimeout(() => this.#bust(), duration);
  }

  /** `bust` — everyone still in loses. */
  async #bust() {
    if (!this.running) return;

    this.status = 'busted';

    /**
     * Settle everyone who did not cash out. Legacy left them in the map and
     * relied on the next round clearing it — so a player who never cashed out
     * had their bet row sit open with no settlement, forever.
     */
    for (const [userId, player] of this.players) {
      if (player.cashedOut) continue;

      try {
        await this.engine.settle({
          userId,
          betId: player.betId,
          profit: `-${player.amount}`,
          result: this.bustPoint,
          hash: this.hash,
          isWinner: false,
          coin: player.coin,
          amount: player.amount,
        });
      } catch (error) {
        this.logger?.error({ err: error, userId, betId: player.betId }, 'Crash bust settlement failed');
      }
    }

    this.io.emit(EVENTS.BUSTED_CRASH, encode({ status: 'busted', crash: this.bustPoint, hash: this.hash }));

    this.timer = setTimeout(() => this.#wait(), BUSTED_MS);
  }

  /** Join the round that is waiting. */
  async join({ userId, amount, coin }) {
    if (this.status !== 'waiting') return { joined: false, reason: 'betting is closed' };
    if (this.players.has(String(userId))) return { joined: false, reason: 'already in this round' };

    const bet = await this.engine.placeBet({ userId, game: crash.key, coin, amount });

    this.players.set(String(userId), {
      betId: bet.betId,
      amount: bet.stake,
      coin: bet.currency,
      cashedOut: false,
    });

    return { joined: true, betId: bet.betId, balance: bet.balance };
  }

  /**
   * Cash out.
   *
   * ── THE MULTIPLIER COMES FROM THE CLIENT ─────────────────────────────
   *
   * `Result.calculateWinning(amount, timeStart, isHuman)` discards its
   * time-based rate when `isHuman` is true and uses `timeStart` — which at the
   * human call site is the multiplier the client asked for. Nothing checks it
   * against the bust point.
   *
   * Ported unchanged; logged when it exceeds what the round could have
   * reached, so the claim is visible.
   */
  async cashout({ userId, payout }) {
    const player = this.players.get(String(userId));
    if (!player) return { cashedOut: false, reason: 'not in this round' };
    if (player.cashedOut) return { cashedOut: false, reason: 'already cashed out' };
    if (this.status !== 'started') return { cashedOut: false, reason: 'the round is not running' };

    const claimed = Number(payout);

    let result;

    if (this.serverAuthority) {
      /**
       * ── SERVER AUTHORITY ──────────────────────────────────────────────
       *
       * The multiplier is what the round has actually REACHED, capped at the
       * bust point. A client asking for more gets the lower of the two rather
       * than a refusal — a cash-out arriving a few milliseconds late is a
       * network fact, not an attack, and refusing it would lose a player a
       * legitimate win.
       */
      const resolved = crashMultiplier({
        startedAt: this.startedAt,
        bustPoint: this.bustPoint,
        requested: claimed,
      });

      if (resolved.capped) {
        this.logger?.warn(
          { userId: String(userId), claimed, granted: resolved.multiplier, reached: resolved.reached },
          'CRASH: cash-out capped at what the round had reached'
        );
      }

      result = {
        cashout: resolved.multiplier,
        won: Number(player.amount) * (resolved.multiplier - 1),
      };
    } else {
      if (claimed > Number(this.bustPoint)) {
        this.logger?.warn(
          { userId: String(userId), claimed, bustPoint: this.bustPoint },
          'CRASH: client claimed a multiplier above the round bust point — see games/crash.js'
        );
      }

      result = crash.calculateWinning(Number(player.amount), claimed, true);
    }

    player.cashedOut = true;

    const settled = await this.engine.settle({
      userId,
      betId: player.betId,
      profit: String(result.won),
      result: result.cashout,
      hash: this.hash,
      isWinner: true,
      coin: player.coin,
      amount: player.amount,
    });

    this.io.emit(
      EVENTS.FINISH_CRASH,
      encode({ uid: String(userId), cashout: result.cashout, won: money.toDecimalString(money.toMinor(String(result.won))) })
    );

    return { cashedOut: true, ...settled };
  }

  /** What a joining client needs to render. The bust point is NOT in it. */
  state() {
    return {
      status: this.status,
      hash: this.hash,
      startedAt: this.startedAt,
      players: this.players.size,
      // `bustPoint` is deliberately absent while a round is running — legacy
      // held it in a module variable and never sent it early either, but it is
      // worth being explicit about why.
      ...(this.status === 'busted' ? { crash: this.bustPoint } : {}),
    };
  }
}

module.exports = { CrashLoop, LOOP_LOCK_ID };
