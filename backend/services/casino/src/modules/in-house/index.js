'use strict';

/**
 * The in-house games.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * PORTED AS-IS, ON INSTRUCTION
 *
 * The rules, payouts and result generation under `games/` are legacy's,
 * carried over rather than redesigned — including the arithmetic that looks
 * wrong. Each file says where its source is and flags what it does; none of it
 * is changed.
 *
 * Three things are NOT ported as-is, because they are infrastructure rather
 * than gameplay:
 *
 *   THE STAKE. `Rule.preparePlay` inserted the bet row and debited in two
 *   unrelated statements, with the affordability check an unlocked read
 *   several callbacks earlier and `reduceBalance` carrying no floor. One
 *   transaction with a guarded debit here — see `engine/gameEngine.js`.
 *
 *   THE SETTLEMENT. `Rule.prepareBusted` updated the bet and paid in two
 *   statements, keyed on `gid` — a value built from a few digits of the clock
 *   plus `Math.floor(Math.random() * 100)`, which collides one time in a
 *   hundred for two bets in the same second and settles the wrong one.
 *
 *   THE QUEUE. An in-process `Map` keyed on uid, with a `plinko` special case
 *   and an unbounded recursive retry. The bet row is the record of an
 *   in-flight bet.
 *
 * ── WHAT IS CARRIED FORWARD DELIBERATELY ─────────────────────────────────
 *
 * `Math.random()` as the outcome source (`engine/hash.js`), and the
 * `canProfit` branch that discards a winning roll when
 * `house.current >= house.max`. Both are legacy behaviour and both are
 * isolated to one place each, so changing them later is a small edit:
 *
 *   - the RNG is `SEED_SOURCE` in `engine/hash.js`
 *   - the switch is `GameEngine.canProfit`, and each game applies it in its
 *     own `make*Result`
 *
 * See `docs/SOCKETS.md` §2 for what the switch does end to end.
 */
module.exports = {
  name: 'in-house',
  service: 'casino',
  basePath: '/in-house',
  models: ['casino', 'core', 'extended'],
  /**
   * Socket-only. Every in-house game is a `C.PLAY_*` socket event; none has
   * an HTTP route in legacy and none needs one.
   */
  routers: {},
  socketOnly: true,
};
