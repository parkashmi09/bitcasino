'use strict';

/**
 * Responsible gambling (rainbet) — a player's own self-exclusions and loss / wager limits,
 * enforced on the server: the wallet refuses a stake (`BET_STAKE` debit) while a break covers it
 * or a limit would be passed, and sign-in is refused during a PLATFORM break.
 *
 * Tables: migration 163. Not in hash-game-exchange — on the hash-sync KEEP list.
 */
module.exports = {
  name: 'responsible-gambling',
  service: 'user',
  basePath: '/responsible-gambling',
  /* `extended` for the two tables, `core` for the ledger and `Users` (tree scope). */
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
