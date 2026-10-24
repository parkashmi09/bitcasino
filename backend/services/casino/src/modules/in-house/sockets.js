'use strict';

const { EVENTS, AUDIENCE, PLATFORM_EVENTS, encode } = require('@ibitplay/socket');

const { GameEngine } = require('./engine/gameEngine');
const { CrashLoop } = require('./engine/crashLoop');
const { KenoLoop } = require('./engine/kenoLoop');

/**
 * The in-house game socket events.
 *
 * Every game follows the same three steps, which is legacy's shape flattened
 * out of its callback pyramid:
 *
 *   1. take the stake and open a bet   (`GameEngine.placeBet`)
 *   2. run the game's own arithmetic    (`games/<name>.js` — unchanged)
 *   3. settle and pay                   (`GameEngine.settle`)
 *
 * Steps 1 and 3 are one transaction each. Step 2 is legacy's, verbatim.
 *
 * ── AND A FAILURE REFUNDS ────────────────────────────────────────────────
 *
 * Several legacy games `assert()` mid-round — `assert(result)` in Limbo,
 * `assert(amount && payout)` in ClassicDice. A failed assert threw between
 * `preparePlay` and `prepareBusted`, so the stake was gone and the bet row sat
 * open forever with no path to close it. Here a throw after the stake is taken
 * refunds it.
 */

/**
 * The games, keyed by the socket event that plays them.
 *
 * @legacy SOCKET 18867ffabc768e07378cdaa6df18c75c
 * @legacy SOCKET 05db5c137ef2e883b7087edce72e2560
 * @legacy SOCKET 893295c0a9bc0fe35edf976858c08ba9
 * @legacy SOCKET 5eda0ea98752c5a85212a01a960ff77
 * @legacy SOCKET 5eda0ea98768e9123231667e7f0178
 * @legacy SOCKET c8286908aae1ad02a33b83dd9f827921
 * @legacy SOCKET 5a828e282af3d79f90ad3b7763052d6e
 * @legacy SOCKET 6ea7f87223223242348c5dd2833b8b2
 * @legacy SOCKET 1c21f730837b2f96d129877063d7720B
 *
 * `C.PLAY_LIMBO`, `C.PLAY_CLASSIC_DICE`, `C.PLAY_HASH_DICE`,
 * `C.PLAY_DIAMOND`, `C.PLAY_MAGIC_WHEEL`, `C.PLAY_WHEEL`,
 * `C.PLAY_SINGLE_KENO`, `C.PLAY_HIGHLOW` and `C.PLAY_ROULETTE` — the wire
 * names, because that is what `tools/socket-inventory.js` counts and what a
 * client sends.
 */
const GAMES = [
  { event: 'PLAY_LIMBO', module: require('./games/limbo') },
  { event: 'PLAY_CLASSIC_DICE', module: require('./games/classicDice') },
  { event: 'PLAY_HASH_DICE', module: require('./games/hashDice') },
  { event: 'PLAY_DIAMOND', module: require('./games/diamond') },
  { event: 'PLAY_MAGIC_WHEEL', module: require('./games/magicWheel') },
  { event: 'PLAY_WHEEL', module: require('./games/wheel') },
  { event: 'PLAY_SINGLE_KENO', module: require('./games/singleKeno') },
  { event: 'PLAY_HIGHLOW', module: require('./games/highLow') },
  { event: 'PLAY_ROULETTE', module: require('./games/roulette') },
];

/**
 * The multi-step games.
 *
 * Each opens a round, takes one or more steps, and settles on a cash-out. The
 * round lives in `in_house_rounds` — see migration 030 for what the in-process
 * queue cost.
 *
 * @legacy SOCKET efc657038309b57bd7ce999191a10f51
 * @legacy SOCKET 5eda0ea98752c5a85223231667e7f0178
 * @legacy SOCKET e2c657038309b57bd7ce999191a10f51
 * @legacy SOCKET e2c657021309b57bd7ce999191a10f51
 * @legacy SOCKET 9ce3bafdf91d8deaae771e67bb2b3eea
 * @legacy SOCKET 1c21e830837b2f96d129877063d7725Q
 * @legacy SOCKET 1c21f730837b2f96d129877063d7725Q
 * @legacy SOCKET 1c21e823212f96113sd7725Q
 * @legacy SOCKET f31c1e97179a0c766a9da0fdde28d3ed
 *
 * `C.PLAY_MINE`, `C.PLAY_TOWER`, `C.PLAY_GOAL`, `C.PLAY_SNAKEANDLADDERS`,
 * `C.PLAY_HILO`, `C.PLAY_BLACKJACK`, `C.PLAY_VIDEOPOKER`,
 * `C.PLAY_THREE_CARD_MONTE` and `C.PLAY_PLINKO`.
 */
const STATEFUL_GAMES = [
  { event: 'PLAY_MINE', module: require('./games/mine') },
  { event: 'PLAY_TOWER', module: require('./games/tower') },
  { event: 'PLAY_GOAL', module: require('./games/goal') },
  { event: 'PLAY_SNAKEANDLADDERS', module: require('./games/snakeAndLadders') },
  { event: 'PLAY_HILO', module: require('./games/hilo') },
  { event: 'PLAY_BLACKJACK', module: require('./games/blackjack') },
  { event: 'PLAY_VIDEOPOKER', module: require('./games/videoPoker') },
  { event: 'PLAY_THREE_CARD_MONTE', module: require('./games/threeCardMonte') },
  { event: 'PLAY_PLINKO', module: require('./games/plinko') },
];

const refuse = (error) => ({
  command: 'error',
  message: error.message,
  code: error.code,
});

/**
 * Tell every connected client that a round settled.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * `LAST_BETS`, `TOP_WINNERS` and `GET casino/bet-history/live` are all PULL —
 * they answer a request with the most recent rows, and nothing tells a client
 * that new rows exist. Legacy had no push either; its board moved only when
 * the page asked again. So a live bets feed could only ever be a poll.
 *
 * `BET_SETTLED` is this project's own event (see `PLATFORM_EVENTS` — it is
 * deliberately NOT in the legacy tables) and carries the settled round, so a
 * feed can prepend a row instead of re-reading itself on a timer.
 *
 * ── `nsp.emit`, NOT `socket.broadcast.emit` ─────────────────────────────
 *
 * Chat excludes the sender because their own message is already in the reply
 * they get. A bets feed is different: the player who just bet should see their
 * round arrive in the ticker like everyone else's, and the ack that drives
 * their game board is a different surface. So this reaches the sender too.
 *
 * ── FAILURE HERE MUST NOT UNDO A SETTLED ROUND ──────────────────────────
 *
 * The money has already moved by the time this runs. A throw would reach the
 * handler's catch, which refunds — turning a broadcast problem into a paid
 * round being taken back. So it never throws.
 * ═════════════════════════════════════════════════════════════════════════
 */
function announceSettled({ context, game, coin, amount, settled, logger }) {
  try {
    context.socket.nsp.emit(
      PLATFORM_EVENTS.BET_SETTLED,
      encode({
        game,
        coin: String(coin ?? '').toLowerCase(),
        amount: String(amount ?? '0'),
        profit: String(settled?.profit ?? '0'),
        win: Boolean(settled?.isWinner),
        reference: String(settled?.betId ?? ''),
        at: new Date().toISOString(),
      })
    );
  } catch (error) {
    logger?.warn({ err: error, game }, 'Could not announce a settled round');
  }
}

function register({ on, deps }) {
  const engine = new GameEngine(deps);
  const { logger, config } = deps;

  /**
   * Server-side outcomes for the four games that took them from the client.
   *
   * OFF by default so the cutover is a deployment decision with a switch, and
   * so the ported-as-is behaviour stays available for comparison. Turn it on —
   * the flag exists to make the change reversible, not to make leaving it off
   * reasonable. See `engine/serverAuthority.js`.
   */
  const serverAuthority =
    config?.INHOUSE_SERVER_AUTHORITY === true || config?.INHOUSE_SERVER_AUTHORITY === 'true';

  if (!serverAuthority) {
    logger?.warn(
      'INHOUSE_SERVER_AUTHORITY is off — plinko, videopoker, blackjack and crash ' +
        'pay on numbers supplied by the client. See engine/serverAuthority.js.'
    );
  }

  for (const { event, module: game } of GAMES) {
    on(EVENTS[event], {
      audience: AUDIENCE.USER,
      /**
       * A game round is one message. Legacy metered nothing and relied on the
       * in-process queue to serialise a player — which it did per process, and
       * skipped entirely for plinko.
       */
      limit: { windowMs: 10_000, max: 60 },
      handle: async (payload, context) => {
        const { amount, coin } = payload ?? {};

        /**
         * The house switch, read once per round exactly as legacy read it, and
         * passed into the game's own result generator. See
         * `GameEngine.canProfit` and each game's `make*Result`.
         */
        const canProfit = await engine.canProfit(context.userId);

        /**
         * VALIDATE FIRST, THEN TAKE THE STAKE.
         *
         * `game.play` is pure — it draws and prices the round and moves no
         * money — so it runs before the debit. A game returning `null` is
         * legacy's silent `return` on a bad parameter (Limbo's
         * `if (payout < 1.01) return;`); it used to arrive AFTER the stake was
         * taken and needed a refund, a reversed wager and a bet row marked
         * `refunded`. Now an invalid round never opens a bet at all.
         */
        let outcome;
        try {
          outcome = game.play({ ...payload, canProfit, serverAuthority, logger });
        } catch (error) {
          logger?.warn({ err: error, game: game.key }, 'In-house round refused before the stake');
          outcome = null;
        }
        if (!outcome) {
          return { command: 'error', message: 'Invalid bet parameters', code: 'INHOUSE_INVALID_STAKE' };
        }

        let bet;
        try {
          bet = await engine.placeBet({
            userId: context.userId,
            game: game.key,
            coin,
            amount,
          });
        } catch (error) {
          if (error.code?.startsWith('INHOUSE_') || error.code === 'NOT_ENTITLED') return refuse(error);
          throw error;
        }

        try {
          const settled = await engine.settle({
            userId: context.userId,
            betId: bet.betId,
            profit: outcome.profit,
            result: outcome.result,
            hash: outcome.hash,
            isWinner: outcome.isWinner,
            coin: bet.currency,
            amount: bet.stake,
          });

          announceSettled({
            context,
            game: game.key,
            coin: bet.currency,
            amount: bet.stake,
            settled,
            logger,
          });

          /**
           * Legacy emitted twice — `{command:"play", …}` immediately and
           * `{command:"busted", …}` after `H.wait(50)`, a timer that served no
           * purpose but let the client animate. Both are in one reply here;
           * the client can pace its own animation.
           */
          return {
            command: 'busted',
            target: settled.result,
            result: settled.result,
            hash: settled.hash,
            profit: settled.profit,
            balance: settled.balance,
            win: settled.isWinner,
            gid: settled.betId,
          };
        } catch (error) {
          /**
           * Anything after the stake was taken. The bet is refunded before the
           * error goes back, so a crash mid-round does not cost the player.
           */
          await engine
            .refund({ userId: context.userId, betId: bet.betId, coin: bet.currency, amount: bet.stake })
            .catch((refundError) =>
              logger?.error({ err: refundError, betId: bet.betId }, 'Refund after a failed round ALSO failed')
            );

          if (error.code?.startsWith('INHOUSE_') || error.code === 'NOT_ENTITLED') return refuse(error);
          throw error;
        }
      },
    });
  }

  /**
   * The multi-step games.
   *
   * One event carries the whole round — `{command}` selects the step, which is
   * legacy's shape (`switch (self.data.command)` at the top of each game).
   */
  for (const { event, module: game } of STATEFUL_GAMES) {
    on(EVENTS[event], {
      audience: AUDIENCE.USER,
      limit: { windowMs: 10_000, max: 120 },
      handle: async (payload, context) => {
        const command = String(payload?.command ?? 'play');

        try {
          if (command === 'play') {
            const canProfit = await engine.canProfit(context.userId);
            const opened = game.open ? game.open({ ...payload, canProfit, serverAuthority }) : null;

            if (game.open && !opened) {
              return { command: 'error', message: 'Invalid bet parameters', code: 'INHOUSE_INVALID_STAKE' };
            }

            /**
             * A game with no `open` is single-shot behind a stateful event —
             * plinko, video poker and blackjack all draw a hash first and
             * settle on a second message. They still need a round, because the
             * hash has to survive between the two.
             */
            const round = await engine.openRound({
              userId: context.userId,
              game: game.key,
              coin: payload?.coin,
              amount: payload?.amount,
              state: opened?.state ?? {},
              hash: opened?.hash,
            });

            /**
             * `state` is what the client is ALLOWED to see of the round.
             *
             * Several of these games cannot be played without it — Video Poker
             * asks which of five cards to hold, Blackjack shows a hand against
             * an up card — and the open reply carried none of it, so a board
             * had nothing to draw and no basis for the decision the next
             * message asks for.
             *
             * A game opts in with `publicState`, and what it leaves out is the
             * point: `deck` is every card still to come, and a client holding
             * it knows the outcome before it chooses. A game with no projection
             * sends nothing, which is right for Mines and Three Card Monte —
             * their whole state IS the answer.
             */
            return {
              command: 'play',
              hash: opened?.hash,
              roundId: round.roundId,
              balance: round.balance,
              state: game.publicState ? game.publicState(opened?.state ?? {}) : undefined,
            };
          }

          const round = await engine.openRoundFor({ userId: context.userId, game: game.key });
          const canProfit = await engine.canProfit(context.userId);

          if (command === 'cashout') {
            const outcome = game.cashout
              ? game.cashout({ amount: round.amount, steps: round.steps, profit: round.profit })
              : game.play({ ...payload, amount: round.amount, state: round.state, hash: round.hash, canProfit, logger, serverAuthority });

            const settled = await engine.closeRound({
              round,
              profit: outcome.profit,
              result: outcome.result ?? round.state,
              isWinner: outcome.isWinner,
            });

            announceSettled({
              context, game: game.key, coin: round.coin, amount: round.amount, settled, logger,
            });
            return { command: 'busted', ...settled, win: settled.isWinner };
          }

          // A step: click, select, high, low.
          const stepFn = game.click ?? game.step;
          if (!stepFn) {
            const outcome = game.play({ ...payload, amount: round.amount, state: round.state, hash: round.hash, canProfit, logger, serverAuthority });
            const settled = await engine.closeRound({
              round, profit: outcome.profit, result: outcome.result, isWinner: outcome.isWinner,
            });
            announceSettled({
              context, game: game.key, coin: round.coin, amount: round.amount, settled, logger,
            });
            /**
             * `slot` and `path` are Plinko's, and they only exist once the ball
             * has landed — so sending them is not a leak, it is the settlement.
             *
             * `closeRound` keeps `profit`, `result` and `isWinner` and drops the
             * rest of the outcome, which left a client with a multiplier and no
             * way to know which of the four slots paying it the ball reached.
             * Without that the drop can only be animated from a guess, and a
             * board animating a guess is exactly the shape of the bug this game
             * already had.
             */
            return {
              command: 'busted',
              ...settled,
              win: settled.isWinner,
              ...(outcome.slot !== undefined ? { slot: outcome.slot, path: outcome.path } : {}),
            };
          }

          const stepped = stepFn({
            state: round.state,
            selected: round.selected,
            land: payload?.land ?? payload?.id,
            amount: round.amount,
            profit: round.profit,
            canProfit,
          });

          // Legacy returns silently on a repeat click; the round is unchanged.
          if (!stepped) return { command: 'ignored' };

          if (stepped.bomb || stepped.isWinner === false) {
            const settled = await engine.closeRound({
              round,
              profit: `-${round.amount}`,
              result: round.state,
              isWinner: false,
              status: 'lost',
            });
            announceSettled({
              context, game: game.key, coin: round.coin, amount: round.amount, settled, logger,
            });
            return { command: 'busted', ...settled, win: false };
          }

          await engine.stepRound({
            round,
            selected: stepped.selected ?? round.selected,
            profit: stepped.profit,
            // HiLo advances its position in the deck here. See `stepRound`.
            state: stepped.state,
          });

          return { command: 'clicked', profit: stepped.profit, id: payload?.land ?? payload?.id, card: stepped.card };
        } catch (error) {
          if (error.code?.startsWith('INHOUSE_') || error.code === 'NOT_ENTITLED') return refuse(error);
          throw error;
        }
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Crash and Keno — shared timed rounds
  // ══════════════════════════════════════════════════════════════════════

  /**
   * These two are not requests. The server runs the round and broadcasts it;
   * a player joins and cashes out against what everyone else is watching.
   *
   * Legacy ran the loop in-process, which under `cluster` meant one game per
   * CPU — eight different Crash rounds on an eight-core box, and which one a
   * player saw depended on their socket. Both loops are singletons behind a
   * Postgres advisory lock now.
   */
  const crashLoop = new CrashLoop({ io: deps.io, models: deps.models, db: deps.db, logger, engine, config });
  const kenoLoop = new KenoLoop({ io: deps.io, db: deps.db, logger, engine });

  /**
   * @legacy SOCKET 05131bff83db9a797b5e9793cfa3bcf6
   *
   * `C.PLAY_CRASH` — join, or cash out.
   */
  on(EVENTS.PLAY_CRASH, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 10_000, max: 60 },
    handle: async (payload, context) => {
      const command = String(payload?.command ?? 'play');

      try {
        if (command === 'cashout') {
          return await crashLoop.cashout({ userId: context.userId, payout: payload?.payout ?? payload?.cashout });
        }
        return await crashLoop.join({ userId: context.userId, amount: payload?.amount, coin: payload?.coin });
      } catch (error) {
        if (error.code?.startsWith('INHOUSE_') || error.code === 'NOT_ENTITLED') return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET dcaa9fd7f23aaf0c29f570becf35b76f
   * @legacy SOCKET 0fd0a8ecb587292055e1c775d6c39a7e
   * @legacy SOCKET d9fe15b677f93abce07076807291e2d6
   * @legacy SOCKET 97c73db9a306213ac2b5c3bdecd20e75
   *
   * `C.STATUS_CRASH`, `C.PLAYERS_CRASH`, `C.HISTORY_CRASH`, `C.FINISH_CRASH` —
   * the round's own state. Public: a visitor watches before signing in.
   */
  on(EVENTS.STATUS_CRASH, { audience: AUDIENCE.PUBLIC, handle: async () => crashLoop.state() });
  on(EVENTS.PLAYERS_CRASH, { audience: AUDIENCE.PUBLIC, handle: async () => crashLoop.state() });
  on(EVENTS.HISTORY_CRASH, {
    audience: AUDIENCE.PUBLIC,
    handle: async () => {
      const rows = await deps.models.Bets.findAll({
        where: { game: 'crash' },
        attributes: ['result', 'hash', 'created'],
        order: [['id', 'DESC']],
        limit: 30,
        raw: true,
      });
      return { history: rows };
    },
  });
  on(EVENTS.FINISH_CRASH, { audience: AUDIENCE.PUBLIC, handle: async () => crashLoop.state() });

  /**
   * @legacy SOCKET a68791c6937532f98fa1be087171f1cc
   *
   * `C.PLAY_KENO`.
   */
  on(EVENTS.PLAY_KENO, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 10_000, max: 60 },
    handle: async (payload, context) => {
      try {
        return await kenoLoop.join({
          userId: context.userId,
          amount: payload?.amount,
          coin: payload?.coin,
          numbers: payload?.numbers,
        });
      } catch (error) {
        if (error.code?.startsWith('INHOUSE_') || error.code === 'NOT_ENTITLED') return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET d57cd08cb7980bfea9552583d35bbcb6
   *
   * `C.STATUS_KENO`.
   */
  on(EVENTS.STATUS_KENO, { audience: AUDIENCE.PUBLIC, handle: async () => kenoLoop.state() });

  /**
   * Claim the loops.
   *
   * Not awaited — a process that does not get the lock still serves sockets
   * and relays what the holder broadcasts, so failing to claim is normal.
   */
  crashLoop.claim().catch((error) => logger?.error({ err: error }, 'Crash loop could not claim'));
  kenoLoop.claim().catch((error) => logger?.error({ err: error }, 'Keno loop could not claim'));

  logger?.info(
    { single: GAMES.length, stateful: STATEFUL_GAMES.length, loops: 2 },
    'In-house game socket events registered'
  );

  return { crashLoop, kenoLoop };
}

module.exports = { register, GAMES, STATEFUL_GAMES };
