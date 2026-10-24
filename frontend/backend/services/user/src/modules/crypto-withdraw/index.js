'use strict';

/**
 * Crypto withdrawals — the review queue for the `withdrawals` table.
 *
 * The sibling of `fiat-withdraw`, and it exists for the same reason that one
 * does: the money is taken from the player when they ASK, and given back only
 * if someone decides not to pay them.
 *
 * ── THE REJECTION NEVER REFUNDED ─────────────────────────────────────────
 *
 * A crypto withdrawal request debits the balance immediately —
 * `legacy/Users/Rule.js` inserts the row and then calls `reduceBalance`. The
 * only endpoint that decides the outcome was:
 *
 *     server.post('/updateWithdrawStatus', async (req, res) => {
 *       const { id, status } = req.body;
 *       UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *
 *
 * That is the whole handler. Rejecting a withdrawal set a string and stopped,
 * so the player's money stayed debited, nothing was ever sent to their wallet,
 * and no ledger entry existed to notice. The same defect as fiat, on a table
 * where the amounts are larger.
 *
 * ── AND IT WAS UNAUTHENTICATED ───────────────────────────────────────────
 *
 * No middleware. Anyone who could reach the port could mark any withdrawal
 * `done`. The audit row it wrote took the actor from an `x-staff-id` REQUEST
 * HEADER, so the trail recorded whoever the caller claimed to be — which is
 * worse than no trail, because it looks like one.
 *
 * ── AND `status` WAS A FREE STRING ───────────────────────────────────────
 *
 * `UPDATE withdrawals SET status = $1` accepted anything. The alert classifier
 * immediately below it matched against a fixed list
 * (`['done','approved','success','completed','paid']`), so a status of
 * `'complete'` — no `d` — was stored, fired no alert, and read as settled to
 * whichever screens matched loosely. There was also no state machine: a
 * withdrawal already `done` could be set back to pending and approved again.
 */
module.exports = {
  name: 'crypto-withdraw',
  service: 'user',
  basePath: '/withdrawals/crypto',
  models: ['core', 'payments'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
