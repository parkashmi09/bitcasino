'use strict';

/**
 * The two jsGames integrations — huidu.bet (v1) and games.ibitplay.com (v2).
 *
 * Kept in one module because they share the thing that matters: how a provider
 * callback becomes exactly one wallet movement. Their protocols differ
 * completely (AES-256-ECB payloads versus HMAC-SHA256 headers), so each has its
 * own adapter under `providers/`.
 *
 *   v2's BET CALLBACK TOOK THE NEW BALANCE FROM THE REQUEST BODY, with no
 *   authentication, no signature and no arithmetic. It was never exploitable
 *   only because the INSERT above it targeted `game_transactions`, a table that
 *   never existed, so the handler threw before reaching the UPDATE. Migration
 *   016 creates that table — which is why the balance is now computed and the
 *   callback verified with the provider's own scheme.
 *
 *   NEITHER CALLBACK HAD DUPLICATE DETECTION. `js_game_transactions` has no
 *   unique column, and the one `ON CONFLICT (external_transaction_id)` in the
 *   codebase names a column with no constraint behind it. Every retry paid
 *   again.
 *
 *   v1 MOVED MONEY WITH NO RECORD when a message carried both a bet and a win —
 *   no branch matched, but the balance UPDATE ran anyway.
 *
 *   v1 NEVER CHECKED THE BALANCE, so `x - bet + win` could go negative.
 *
 *   `POST /jsGames/game/transfer` credited the PROVIDER's wallet for any named
 *   player, unauthenticated, without debiting ours.
 *
 *   Both launches and the history endpoint took the player id from the request.
 *
 * The v1 AES key and the v2 API secret were both hard-coded in the source and
 * are in the repository history. Rotate them with the providers.
 */
module.exports = {
  name: 'js-games',
  service: 'casino',
  basePath: '/js-games',
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
