'use strict';

/**
 * Withdrawal address whitelist — gap 16.
 *
 * A third sibling to `/withdrawals/crypto` and `/withdrawals/fiat`, which is
 * where the two payout rails already live.
 *
 * The table and the `users.withdraw_whitelist_only` column are migration 039;
 * every decision behind them — why the switch is not in `userconfig`, why the
 * address is not format-checked, why the unique key includes the currency — is
 * argued at the head of that file rather than repeated here.
 */
module.exports = {
  name: 'withdrawal-whitelist',
  service: 'user',
  basePath: '/withdrawals/whitelist',
  /* `core` for `Users` (the switch), `extended` for the addresses. */
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};
