'use strict';

/**
 * Operator controls over a single account — password, status, limits, and a
 * direct wallet refill.
 *
 * `legacy/system/routes/lords.js` is the most carefully guarded code in the
 * platform: `protectStaff` on the router, a TRANSACTION PASSWORD on every
 * write, hierarchy checks against the closure table, and `SELECT … FOR UPDATE`
 * before every balance change. It is worth saying so, because the findings
 * below are narrow by comparison.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE PASSWORD RESET WRITES CLEARTEXT — FOR BOTH STAFF AND PLAYERS
 *
 *     const hash = await bcrypt.hash(newPassword, 10);
 *     UPDATE staff SET password=$1, password2=$2 WHERE id=$3
 *     UPDATE users SET password=$1, password2=$2 WHERE id=$3
 *
 * `password2` is the plaintext. This is the third and fourth place that column
 * is written in this codebase — `sportsbet/routes.js` and
 * `system/controllers/staffController.js` are the others — and this one covers
 * every account type. Every password an operator has ever set through this
 * endpoint is readable by anyone with SELECT on those tables.
 *
 * ── AND `BEGIN` IS ON THE ONE SHARED CLIENT ──────────────────────────────
 *
 * `General/Model` exports a single `pg.Client` for the whole process, so
 * `pg.query('BEGIN')` in `quickRefill` opens a transaction on the only
 * connection there is. Every concurrent request then runs inside it — the
 * `FOR UPDATE` locks are real, but they are held on behalf of whatever else is
 * in flight, and a `ROLLBACK` from one handler discards another's writes.
 *
 * ── THE OWNER REFILLS FROM NOWHERE ───────────────────────────────────────
 *
 *     if (!isOwner(req.staff)) { ...check and debit the caller... }
 *     else { ...just check the player exists... }
 *     await addBalance('USER', userId, amt);
 *
 * The platform owner credits a player with no funding source and no ceiling.
 * That is the correct model — the house is where money enters — but legacy
 * neither logged it as issuance nor bounded it, so an operator error or a
 * compromised owner account is indistinguishable from ordinary business in the
 * ledger.
 */
module.exports = {
  name: 'lords',
  service: 'admin',
  basePath: '/accounts',
  models: ['admin', 'core'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
