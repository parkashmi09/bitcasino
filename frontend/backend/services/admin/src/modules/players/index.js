'use strict';

/**
 * Creating, editing and closing a player account.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `DELETE /api/staff/players/:id` DESTROYED THE FINANCIAL RECORD
 *
 * It did not delete a user. It searched the database for anything that might
 * refer to one, and deleted all of it:
 *
 *     const possCols = ['user_id', 'userid', 'uid', 'id_user', 'user'];
 *     const { rows: tbls } = await pg.query(
 *       `SELECT table_name, column_name
 *          FROM information_schema.columns
 *         WHERE table_schema = 'public'
 *           AND table_name  <> 'users'
 *           AND lower(column_name) = ANY($1)`, [possCols]);
 *
 *     for (const { table, col } of targets) {
 *       await pg.query(`DELETE FROM "${table}" WHERE "${col}" = $1`, [playerId]);
 *     }
 *
 * On this schema that reaches `credits_ledger`, `SportsBet`, `gis_transactions`,
 * `fiat_deposits`, `fiat_withdrawals`, `apaydeposits`, `apaywithdrawals`,
 * `ccdeposit`, `withdrawals`, `user_kyc` — every deposit the player ever made,
 * every withdrawal paid out to them, every bet they placed and every ledger row
 * explaining their balance. One request, unrecoverable, on a licensed gambling
 * platform with record-retention obligations.
 *
 * It is worse than a cascade, because the target list is DISCOVERED rather than
 * declared: any table added later with a column named `uid` joins the blast
 * radius automatically, and a table where `uid` means something ELSE loses rows
 * by coincidence of number. `'user'` is in the list, so a column literally
 * called `user` qualifies too.
 *
 * It also answered with `user: userRow[0]` — the deleted row in full, including
 * the bcrypt hash and the `password2` cleartext.
 *
 * ── WHAT THIS DOES INSTEAD ───────────────────────────────────────────────
 *
 * Closes the account and anonymises the personal data, leaving the financial
 * record intact and attributable. A closed player cannot log in, holds no
 * contact details, and every deposit and bet they made still reconciles.
 * Actually erasing a customer is a data-retention decision with legal weight;
 * it is not something a route should do because someone clicked a red button.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * AND THREE MORE, IN `createPlayer`
 *
 * 1. THE PASSWORD WAS LOGGED. Line two of the handler:
 *
 *        console.log("createPlayer", { creator, body: req.body });
 *
 *    `req.body` contains `password`. Sixth site in this codebase where a
 *    cleartext password reaches the logs, after the staff login and the four
 *    `password2` writers.
 *
 * 2. `password2` AGAIN — the fifth writer of the cleartext-password column.
 *
 * 3. EVERY EARLY RETURN LEAKED AN OPEN TRANSACTION. The handler opens with
 *    `await pg.query("BEGIN")`, and the permission check, the duplicate check
 *    and the balance check each `return res.status(400)…` without a ROLLBACK.
 *    `legacy/General/Model/index.js` exports a single `pg.Client`, so that
 *    BEGIN is on the only connection the process has — a rejected player
 *    creation left every subsequent request on the platform running inside an
 *    abandoned transaction.
 *
 * 4. A NEGATIVE `initial_balance` RAN BACKWARDS. The check is
 *    `if (initial_balance > 0)` for the funds test and `if (initial_balance >
 *    0)` for the transfer, both skipped for a negative — but nothing rejected
 *    it, and `initial_balance` came off the body unvalidated.
 */
module.exports = {
  name: 'players',
  service: 'admin',
  basePath: '/players',
  models: ['admin', 'core', 'payments', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
