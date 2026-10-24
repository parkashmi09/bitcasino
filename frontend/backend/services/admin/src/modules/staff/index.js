'use strict';

/**
 * The staff hierarchy — accounts, the players under them, and the money that
 * moves between the two.
 *
 * `legacy/system/` is the best-built code in this platform: it has real token
 * authentication (`protectStaff`), a closure table for the tree, and an audit
 * recorder wired onto every write. What follows is what is wrong with it
 * anyway, and the list is shorter than anywhere else in the port.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE TRANSFER IS NOT A TRANSACTION, AND THE BALANCE CHECK IS ADVISORY
 *
 *     await pg.query("BEGIN");
 *     ...
 *     const bal = (await pg.query("SELECT inr FROM staff_balances WHERE staff_id=$1")).rows[0]?.inr || 0;
 *     if (amount > bal) return res.status(400).json({ error: "Insufficient INR" });
 *     await transferInr(pg, srcType, srcId, dstType, dstId, amount, false, direction);
 *
 * `pg` is a single shared `pg.Client` — `General/Model` constructs one
 * Client for the whole process and exports it. So `BEGIN` does not open a
 * transaction for THIS request; it opens one on the only connection there is,
 * and every concurrent request in the process then runs inside it. A `ROLLBACK`
 * from one request discards another request's writes, and two overlapping
 * handlers interleave into a single transaction neither of them can reason
 * about.
 *
 * The debit, the credit and the history row are therefore not atomic with each
 * other and ARE entangled with whatever else is in flight. Several of the early
 * returns above also exit without a ROLLBACK, leaving that shared connection
 * inside an open transaction for every request that follows.
 *
 * And `transferInr` debits with:
 *
 *     UPDATE staff_balances SET inr = inr - $1 WHERE staff_id = $2
 *
 * with no `WHERE inr >= $1`. The check that ran before it was an unlocked read,
 * so two transfers issued at once both pass it and both debit — the account
 * goes negative and nothing notices.
 *
 * ── TWO ROUTES ARE UNREACHABLE ───────────────────────────────────────────
 *
 *     router.get('/:id', ctrl.getById);          // line 84
 *     ...
 *     router.get('/transactions', ctrl.transferHistory);   // line 97
 *
 * Express matches in declaration order, so `GET /api/staff/transactions` hits
 * `/:id` with `id = 'transactions'` and never reaches the transfer history.
 * The same shape shadows `/transfers/summary`, which is declared after
 * `/transfers/:id?`.
 *
 * ── AND THE PASSWORD IS STORED IN CLEARTEXT ──────────────────────────────
 *
 *     UPDATE staff SET password=$1, password2=$2 WHERE id=$3
 *                                   ^^^^^^^^^^^ the plaintext
 *
 * The same `password2` column pattern as `users`. Every staff password ever
 * changed through this endpoint is readable by anyone with SELECT on the table.
 */
module.exports = {
  name: 'staff',
  service: 'admin',
  basePath: '/staff',
  models: ['admin', 'core'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
