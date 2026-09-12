'use strict';

/**
 * The `house` counters.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `house` DECIDES WHETHER A PLAYER IS ALLOWED TO WIN
 *
 * An earlier version of this comment said the opposite — that nothing reads
 * `house` and it is "a display fixture". That was wrong, and it was wrong
 * because it was based on grepping `legacy/index.js` for `FROM house`, which
 * finds only the cron job and the six routes. The read is in `Users/Rule.js`:
 *
 *     Games/ClassicDice/index.js:89  Rule.checkLimited(self.id, coin, (status) => {
 *     Games/Rule.js:329              → Agent.canProfit(id, coin, cb)
 *     Games/Agent.js:93              → UserRule.checkMaxProfit(id, cb)
 *     Users/Rule.js:2314             → SELECT * FROM house WHERE uid = $1
 *                                      callback(current < max)
 *
 * and `status` goes straight into the result generator:
 *
 *     let randomResult = Result.make(status, self.data);
 *
 * `Games/ClassicDice/Result.js`, when `canProfit` is false:
 *
 *     if (type === "Under") {
 *       if (result < roll) {                       // the player WOULD have won
 *         let res = roll + 1 + "." + H.getRandomBetween(10, 98);
 *         return { hash, result: parseFloat(res) };       // forced to a loss
 *       }
 *
 * A winning roll is discarded and replaced with a number one step the wrong
 * side of the player's target — and the `hash` returned is the hash of the
 * DISCARDED roll, so what the player is shown does not correspond to what they
 * were given.
 *
 * `Rule.checkLimited` is consulted by SIXTEEN games: ClassicDice, HashDice,
 * Diamond, Tower, ThreeCardMonte, Wheel, VideoPoker, MagicWheel, HighLow, Mine,
 * Limbo, SnakeAndLadders, SingleKeno, Goal, Hilo and Roulette.
 *
 * See `docs/SOCKETS.md` §2 for the full chain.
 *
 * ── WHICH MAKES THE TWO WHOLE-TABLE ROUTES THE SWITCH ────────────────────
 *
 *     server.get('/win-house', …)   UPDATE house SET max = 0, current = 0
 *
 * No WHERE clause, so `current < max` becomes false for EVERY player at once:
 * nobody can win. `/reset-house` (`max = 50, current = 0`) turns it back on.
 * Both were unauthenticated GET requests, and the route is named for who wins.
 *
 * ── THE CRON JOB IS STILL DECORATIVE ─────────────────────────────────────
 *
 * The ticker that walks the counters between those two states describes itself:
 *
 *     // Illusion logic with a 70-30 win-loss ratio
 *
 * It moves `current` and `max` up and down at random every minute, which is
 * what determines when a given player crosses from "may win" to "may not".
 * That the WALK is arbitrary does not make the STATE it produces decorative —
 * which is the distinction the earlier comment missed.
 *
 * ── NOTHING HERE REPRODUCES THE RIGGING ──────────────────────────────────
 *
 * This module serves the counters: read them, set them, and run the ticker. No
 * ported game consults them, because no in-house game is ported yet. When they
 * are, a house edge belongs in whether a bet is ACCEPTED — a declared RTP or a
 * max-profit-per-player rule — not in rewriting a result after the fact and
 * publishing a hash for a different roll.
 *
 * ── ALL SIX WERE UNAUTHENTICATED, AND FOUR OF THEM WRITE ─────────────────
 *
 *     server.get('/start-house',  …)   starts a cron job
 *     server.get('/stop-house',   …)   stops it
 *     server.get('/reset-house',  …)   UPDATE house SET max = 50, current = 0
 *     server.get('/win-house',    …)   UPDATE house SET max = 0,  current = 0
 *     server.post('/updatehouse', …)   UPDATE … WHERE uid = $3
 *     server.get('/gethouse',     …)   every player's counters, with their name
 *
 * No middleware on any of them. The two UPDATEs have NO WHERE CLAUSE — they
 * rewrite every row in the table — and they are GET requests, so a link, a
 * prefetching browser or a crawler following a URL is enough to fire them.
 * A `GET` that writes is also reachable cross-site in ways a POST is not.
 *
 * ── AND `/start-house` LEAKS A CRON JOB EVERY TIME ───────────────────────
 *
 *     let task;
 *     const startAutomaticMode = () => {
 *       task = cron.schedule('* * * * *', async () => { … });
 *       task.start();
 *     };
 *
 * `task` is overwritten, not replaced — the previous job is still scheduled and
 * nothing holds a reference to stop it. Calling `/start-house` n times leaves n
 * jobs, each doing a full scan of `house` and one UPDATE per row per minute,
 * forever. `stopAutomaticMode` stops only the most recent.
 *
 * Here the scheduler is a module-level singleton that replaces rather than
 * accumulates, the writes are POSTs behind `config:write` and audited, and the
 * two whole-table updates name their scope explicitly.
 */
module.exports = {
  name: 'house',
  service: 'casino',
  basePath: '/house',
  models: ['casino', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
