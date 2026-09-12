'use strict';

/**
 * Crypto deposits arriving — the CCPayment webhook, the node callbacks, and
 * the coin/chain metadata a deposit screen needs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE CREDIT COLUMN WAS INTERPOLATED FROM THE WEBHOOK BODY
 *
 *     const coinSymbolLower = coinSymbol.toLowerCase();
 *     const updateQuery =
 *       `UPDATE credits SET ${coinSymbolLower} = ${coinSymbolLower} + $1 WHERE uid = $2::bigint`;
 *     await pg.query(updateQuery, [amount, userid]);
 *
 * `coinSymbol` comes from the provider's JSON. The amount is parameterised;
 * the COLUMN NAME is not. A `coinSymbol` of `usdt = 999999, x` rewrites the
 * statement.
 *
 * The webhook signature IS verified first, which is the only reason this is not
 * trivially reachable — and the secret it is verified against is
 * `48e60e26e298f7bb6023209f9c48b91c`, hardcoded in `legacy/index.js`. Anyone
 * holding this repository can sign a webhook. It is on the rotation list, and
 * so is the column name: the currency is looked up in a fixed map here and a
 * symbol that is not in it is refused rather than interpolated.
 *
 * ── AND THE TRANSACTION SPANS AN OUTBOUND HTTP CALL ──────────────────────
 *
 *     await pg.query('BEGIN');
 *     await pg.query('SELECT pg_advisory_xact_lock(hashtext($1))', [orderId]);
 *     ...
 *     getOrderInfo(orderId, async (orderInfoRaw) => {   // ← a CALLBACK
 *       ...
 *       await pg.query('COMMIT');
 *     });
 *
 * The COMMIT happens in a later tick, inside a callback, after a round trip to
 * CCPayment. On the ONE shared `pg.Client` this process uses, that transaction
 * — and its advisory lock — is held open across a network call, blocking every
 * other request in the process. If the provider never answers, it is held until
 * the socket dies.
 *
 * ── NO LEDGER ROW ────────────────────────────────────────────────────────
 *
 * `UPDATE credits SET <coin> = <coin> + $1` and nothing else, so a crypto
 * deposit appeared on no statement and could not be reconciled. Every movement
 * here goes through the wallet.
 */
module.exports = {
  name: 'crypto',
  service: 'user',
  basePath: '/crypto',
  models: ['core', 'payments', 'extended'],
  routers: {
    // Provider callbacks cannot carry our token — they are authenticated by
    // signature. `public` is an AUDIENCE, so this mounts without a guard.
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    /**
     * `POST /hr` — recording an INR deposit somebody says they made. Legacy
     * served it unauthenticated with `Access-Control-Allow-Origin: *`.
     */
    admin: require('./routes/admin.routes'),
  },
};
