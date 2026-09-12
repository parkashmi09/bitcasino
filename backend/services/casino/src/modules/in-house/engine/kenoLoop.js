'use strict';

const { EVENTS, encode } = require('@ibitplay/socket');

const keno = require('../games/keno');
const { KENO_WAITING_MS, KENO_DRAW_MS, KENO_BUSTED_MS } = require('../inHouse.constants');

/**
 * The Keno round loop.
 *
 * Like Crash, a shared timed round rather than a request — legacy's
 * `waiting → started → busted` chain of `H.wait` calls with module-level
 * `status`, `player_playing` and `roundNumbers`.
 *
 * Also like Crash, every `cluster` worker ran its own copy, so the platform
 * had one Keno game per CPU and which one a player saw depended on their
 * socket. Singleton behind the same advisory lock.
 */

const LOOP_LOCK_ID = 918_273_642;

class KenoLoop {
  constructor({ io, db, logger, engine }) {
    this.io = io;
    this.db = db;
    this.logger = logger;
    this.engine = engine;

    this.status = 'busted';
    this.hash = '';
    this.roundNumbers = [];
    /** userId -> { betId, amount, coin, picks } */
    this.players = new Map();

    this.timer = null;
    this.running = false;
  }

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
      this.logger?.info('Keno loop is running elsewhere — this process will relay only');
      return false;
    }

    this.logger?.info('Keno loop claimed');
    this.running = true;
    this.#wait();
    return true;
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Betting is open. */
  #wait() {
    if (!this.running) return;

    this.status = 'waiting';
    this.players.clear();
    this.roundNumbers = [];

    this.io.emit(EVENTS.WAITING_KENO, encode({ status: 'waiting', waitMs: KENO_WAITING_MS }));
    this.timer = setTimeout(() => this.#draw(), KENO_WAITING_MS);
  }

  /** Draw the numbers and settle everyone. */
  async #draw() {
    if (!this.running) return;

    this.status = 'started';
    this.io.emit(EVENTS.STARTED_KENO, encode({ players: this.players.size }));

    const drawn = keno.drawRound();
    this.hash = drawn.hash;
    this.roundNumbers = drawn.numbers;

    // Legacy revealed them one at a time on a timer (`C.KENO_AMOUNT`); the
    // whole set goes out at once and the client can pace the reveal.
    this.io.emit(EVENTS.KENO_AMOUNT, encode({ numbers: this.roundNumbers }));

    const winners = [];

    /**
     * EVERY player is settled. Legacy's loop used `return` where it meant
     * `continue`, so the first non-winner aborted settlement for everyone
     * after them — see `games/keno.js`.
     */
    for (const [userId, player] of this.players) {
      try {
        const outcome = keno.settlePlayer({
          picks: player.picks,
          roundNumbers: this.roundNumbers,
          amount: player.amount,
        });

        await this.engine.settle({
          userId,
          betId: player.betId,
          profit: outcome.profit,
          result: this.roundNumbers,
          hash: this.hash,
          isWinner: outcome.isWinner,
          coin: player.coin,
          amount: player.amount,
        });

        if (outcome.isWinner) winners.push({ uid: String(userId), won: outcome.profit, matches: outcome.matches });
      } catch (error) {
        // One player's failure must not stop the rest — which is the whole
        // point of the bug above.
        this.logger?.error({ err: error, userId, betId: player.betId }, 'Keno settlement failed for one player');
      }
    }

    this.status = 'busted';
    this.io.emit(EVENTS.BUSTED_KENO, encode({ numbers: this.roundNumbers, hash: this.hash, winners }));

    this.timer = setTimeout(() => this.#wait(), KENO_BUSTED_MS);
  }

  /** Join the round that is waiting. */
  async join({ userId, amount, coin, numbers }) {
    if (this.status !== 'waiting') return { joined: false, reason: 'betting is closed' };
    if (this.players.has(String(userId))) return { joined: false, reason: 'already in this round' };

    const picks = Array.isArray(numbers) ? numbers.map(Number).filter(Number.isInteger) : [];
    if (!picks.length) return { joined: false, reason: 'pick some numbers' };

    const bet = await this.engine.placeBet({ userId, game: keno.key, coin, amount });

    this.players.set(String(userId), {
      betId: bet.betId,
      amount: bet.stake,
      coin: bet.currency,
      picks,
    });

    return { joined: true, betId: bet.betId, balance: bet.balance, picks };
  }

  /** The drawn numbers are absent while betting is open. */
  state() {
    return {
      status: this.status,
      players: this.players.size,
      ...(this.status === 'busted' ? { numbers: this.roundNumbers, hash: this.hash } : {}),
    };
  }
}

module.exports = { KenoLoop, LOOP_LOCK_ID };
