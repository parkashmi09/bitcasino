'use strict';

/**
 * The XGaming / GamingHub360 aggregator.
 *
 * Six callbacks the provider makes into this platform, and one route the
 * player's own client calls to open a game.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. THE SIGNATURE DOES NOT COVER THE PAYLOAD
 *
 *     const verifyHash = (command, request_timestamp, reqHash) => {
 *       const calculatedHash = crypto.createHash('sha1')
 *         .update(command + request_timestamp + SECREATEkEYCASINO).digest('hex');
 *       return calculatedHash === reqHash;
 *     };
 *
 * `command` and `request_timestamp` are signed. `data` is NOT — and `data` is
 * where `user_id`, `session`, `amount` and `transaction_type` live.
 *
 * So one captured request authenticates ANY body with the same command. Take a
 * genuine `changebalance` callback off the wire, keep its `command`,
 * `request_timestamp` and `hash`, and replace `data` with
 * `{"user_id": <anyone>, "transaction_type": "WIN", "amount": 1000000, …}`.
 * The hash still verifies. That is the entire security model of this
 * integration, and it authenticates nothing that matters.
 *
 * `request_timestamp` is never checked for freshness either, so a captured
 * hash is valid forever. And the comparison is `===` on a hex string — not
 * constant-time, though that is the least of it here.
 *
 * ── 2. THE WALLET COLUMN CAME FROM AN UNAUTHENTICATED REQUEST BODY ───────
 *
 *     await pg.query(`UPDATE credits SET ${coin} = $1 WHERE uid = $2`, …);
 *
 * `coin` is read from `game_runs.coin`. That row was written by
 * `POST /api/casino/gamerun`, which has NO authentication and takes both
 * `user_id` and `coin` straight from the body. So:
 *
 *     POST /api/casino/gamerun {"user_id": <victim>, "coin": "inr = 999999, usdt"}
 *
 * plants a session, and the next changebalance on it runs
 *
 *     UPDATE credits SET inr = 999999, usdt = $1 WHERE uid = <victim>
 *
 * Second-order SQL injection ending in an arbitrary balance write, reachable
 * without knowing the provider secret at all. The amount was parameterised;
 * the column name was not. Same shape as the CCPayment webhook found earlier,
 * except that one at least required a signature.
 *
 * ── 3. `/gamerun` LETS ANYONE OPEN A GAME AS ANYONE ──────────────────────
 *
 * Independent of the injection: `user_id` off the body with no token means a
 * session can be opened against any player's account and played with their
 * balance.
 *
 * ── 4. THE BALANCE MOVE IS READ-MODIFY-WRITE ─────────────────────────────
 *
 *     const userBalance = parseFloat((userCredits[coin] || 0).toFixed(2));
 *     … updatedBalance = userBalance - amount …
 *     if (updatedBalance < 0) errorMessage = "Insufficient balance for BET";
 *     await pg.query(`UPDATE credits SET ${coin} = $1 …`, [updatedBalance, …]);
 *
 * Unlocked read, arithmetic in JavaScript, absolute write. Two concurrent bets
 * both read the same balance and the second write erases the first — the
 * player bets twice and pays once. The floor check is on a value read before
 * the write, so it does not hold at the moment the write happens.
 *
 * Here every move is a GUARDED UPDATE inside one transaction, with the row
 * count as the answer.
 *
 * ── 5. AND THE TRANSACTION RECORD NEVER EXISTED ──────────────────────────
 *
 * `transactionscasino` is referenced four times and was created by nothing —
 * the fifth such table in this port. `insertOrUpdateTransaction` throws, and
 * it is called AFTER the balance write, so the money moved, the record failed,
 * and the provider received a 500 for a bet already taken. Providers retry a
 * 500. The only duplicate check was a SELECT against that same missing table.
 *
 * Migration 028 creates it with a UNIQUE constraint on `transaction_id`, so a
 * retry returns the original outcome instead of paying again.
 */
module.exports = {
  name: 'x-casino',
  service: 'casino',
  basePath: '/x-casino',
  models: ['casino', 'core', 'extended'],
  routers: {
    /**
     * The provider's callbacks. `public` is the AUDIENCE — they carry no staff
     * or player guard because the provider has neither; the signature is the
     * authentication, and unlike legacy's it covers the payload.
     */
    public: require('./routes/public.routes'),
    /** Opening a game. The player comes from their own token. */
    user: require('./routes/user.routes'),
  },
};
