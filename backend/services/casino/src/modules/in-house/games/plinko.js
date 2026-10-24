'use strict';

const { makeHash } = require('../engine/hash');
const { plinkoDrop } = require('../engine/serverAuthority');

/**
 * Plinko.
 *
 * PORTED AS-IS from `legacy/Games/Plinko/index.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠ THE PAYOUT MULTIPLIER COMES FROM THE CLIENT
 *
 * Plinko is two messages in legacy: `play()` draws a hash and emits it, then
 * `busted()` settles. And `busted()` reads the multiplier out of the SECOND
 * message:
 *
 *     busted() {
 *       let { bonus } = self.data;          // ← from the client
 *       bonus = parseFloat(bonus);
 *       ...
 *       else if (parseFloat(result) > 5.60) {
 *         isWinner = true;
 *         profit = (amount * bonus) - amount;     // ← paid on the client's number
 *       }
 *
 * Nothing on the server computes where the ball landed. The client says which
 * slot it hit and is paid accordingly. `bonus: 1000000` on a stake of 1 pays
 * 999,999.
 *
 * That is not a subtle bug like Magic Wheel's `result !== 24` — it is a
 * withdrawal endpoint. It is ported unchanged because the instruction was to
 * take the games as they are, and changing what a game pays is not a porting
 * decision. But it should be closed before this reaches production, and the
 * fix is small: the server draws the slot and ignores the client's number.
 *
 * What IS added is a log line — `SUSPICIOUS_MULTIPLIER` below. It changes no
 * behaviour and makes the exploit visible rather than silent, which is the
 * least that can be done without altering the game.
 *
 * ── AND `Queue.exists` WAS SKIPPED FOR PLINKO ────────────────────────────
 *
 *     let exists = Queue.exists(id);
 *     if (game === "plinko") { exists = false; }
 *
 * The in-flight check that serialised a player's bets was disabled for this
 * game specifically — so plinko could have several rounds open at once, each
 * settling from the client's own `bonus`.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * The largest multiplier the real paytable can produce.
 *
 * Used ONLY to decide whether to log. Legacy applies no ceiling and neither
 * does this — see the header.
 */
const PAYTABLE_MAX = 5.6;

/** Legacy's `play()` — draws the hash, no outcome yet. */
function open() {
  return { hash: makeHash() };
}

/**
 * Legacy's `busted()`, verbatim.
 *
 * The `result` IS the client's `bonus`, formatted — legacy does
 * `let result = parseFloat(bonus).toFixed(2)` and then branches on the string.
 */
function play({ amount, bonus, hash, logger, serverAuthority }) {
  /**
   * ── SERVER AUTHORITY ────────────────────────────────────────────────
   *
   * With `INHOUSE_SERVER_AUTHORITY=true` the ball is dropped here and the
   * client's `bonus` is ignored entirely. The paytable and the binomial drop
   * are in `engine/serverAuthority.js`.
   *
   * A client still claiming a multiplier is logged, because that is now an
   * attempt rather than the protocol.
   */
  if (serverAuthority) {
    const drop = plinkoDrop();
    const claimed = parseFloat(bonus);

    if (Number.isFinite(claimed) && claimed !== drop.multiplier) {
      logger?.warn(
        { claimed, actual: drop.multiplier, slot: drop.slot },
        'PLINKO: client sent a multiplier; the server drew its own'
      );
    }

    const stake = Number(amount);
    const isWinner = drop.multiplier > 0;
    const profit = isWinner ? stake * drop.multiplier - stake : -stake;

    return {
      result: drop.multiplier.toFixed(2),
      hash: hash ?? makeHash(),
      profit: String(profit),
      isWinner,
      slot: drop.slot,
      path: drop.path,
    };
  }

  const multiplier = parseFloat(bonus);
  const result = parseFloat(bonus).toFixed(2);

  if (Number.isNaN(multiplier)) return null;

  if (multiplier > PAYTABLE_MAX) {
    /**
     * Not a refusal — legacy pays this. A line in the log so that a client
     * claiming a slot the board cannot produce is visible.
     */
    logger?.warn(
      { bonus: multiplier, paytableMax: PAYTABLE_MAX, stake: amount },
      'PLINKO: client claimed a multiplier above the paytable — see games/plinko.js'
    );
  }

  const stake = Number(amount);
  let isWinner = false;
  let profit = 0.0;

  // Legacy's exact string comparisons and order.
  if (result === '0.50') {
    isWinner = true;
    profit = stake / 2;
  } else if (result === '1.00') {
    isWinner = true;
    profit = 0.0;
  } else if (result === '1.10') {
    isWinner = true;
    profit = stake / 10;
  } else if (result === '5.60') {
    isWinner = true;
    profit = stake * 4.5;
  } else if (parseFloat(result) > 5.6) {
    isWinner = true;
    profit = stake * multiplier - stake;
  } else {
    isWinner = false;
    profit = -stake;
  }

  return { result, hash: hash ?? makeHash(), profit: String(profit), isWinner };
}

module.exports = { play, open, PAYTABLE_MAX, key: 'plinko' };
