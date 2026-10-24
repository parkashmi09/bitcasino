'use strict';

/**
 * Peer-to-peer tips — a player sends part of their balance to another player by username.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What the reference implementation got wrong, and this one does not
 *
 * The tip controller this replaces took `fromUid` from the request BODY, so any
 * caller could tip from any account — a one-line way to empty someone else's
 * wallet. It then moved the money with `UPDATE credits SET ${coin} = …`: a
 * column name built from the request (SQL injection into the balance table) and
 * no ledger row, so a tip left no trace in either player's statement.
 *
 * Here the sender is the verified token (`req.user.id`), the currency goes
 * through the wallet's allow-list, and the money moves only through
 * `WalletService` — a `TIP_SENT` debit and a `TIP_RECEIVED` credit, both ledger
 * rows and the `tips` row in one transaction. Migration 077.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Player routes   /api/v1/user/tip/...         (send + users need the `tips` entitlement)
 * Staff routes    /api/v1/admin/user/tip/...   (scoped to the caller's tree)
 */
module.exports = {
  name: 'tip',
  service: 'user',
  basePath: '/tip',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
