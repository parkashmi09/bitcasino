'use strict';

/**
 * Recurring bonuses (daily / weekly / monthly) and redeem codes.
 *
 * Four things were wrong and all four are worth knowing:
 *
 *   The claim paid twice. Select-then-unconditional-update, the same shape as
 *   the gift-card bug.
 *
 *   The VIP gate was on the READ endpoint only. A player shown "not eligible"
 *   could claim anyway by calling the claim endpoint directly.
 *
 *   Authentication was a shared static header key (`role-key`) plus a `userid`
 *   query parameter — one key for every player.
 *
 *   Nothing wrote a ledger row, so bonus payments appeared on no statement.
 *
 * The VIP ladder itself moved to `vipLevels.js`, extracted verbatim, with the
 * top-band bug fixed: past the last threshold the legacy function returned an
 * error object and its callers turned that into VIP 0.
 */
module.exports = {
  name: 'bonus',
  service: 'user',
  basePath: '/bonus',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
