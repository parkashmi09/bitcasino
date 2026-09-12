'use strict';

/**
 * The casino provider's seamless wallet — every bet and every win.
 *
 * Four defects, all in the legacy handlers, all fixed here:
 *
 *   The signature covered only the ACTION NAME, and `request_time` was never
 *   checked — so one captured signature worked forever, for any member and any
 *   amount. That is the provider's protocol; what is done about it is a
 *   freshness window, per-transaction idempotency, and an optional stronger
 *   scheme (SEAMLESS_SIGN_MODE=full) for when the provider supports one.
 *
 *   Duplicate detection was a stub returning `false`, so every provider retry
 *   was paid again.
 *
 *   The balance was read, changed in JavaScript, and written back whole — so
 *   two concurrent movements lost one of themselves.
 *
 *   The thousands conversion for IDR2/KRW2/MMK2/VND2/LAK2/KHR2 was applied to
 *   the player's WHOLE STORED BALANCE rather than to the amount.
 *
 * The hard-coded `SECRET_KEY` from `legacy/index.js:2376` must be rotated with
 * the provider — it has been in the repository history.
 */
module.exports = {
  name: 'seamless',
  service: 'casino',
  basePath: '/seamless',
  models: ['casino', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    // The operator side of the same integration — products, games, launch.
    // `POST /launch-game` read `users.password` and posted the bcrypt hash to
    // the provider, on an unauthenticated route where the caller named the
    // player. See `seamlessCatalogue.service.js`.
    user: require('./routes/user.routes'),
  },
};
