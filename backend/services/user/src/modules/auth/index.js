'use strict';

/**
 * Player authentication module.
 *
 * Replaces the login handling in `legacy/index.js` and `legacy/Users/Token.js`,
 * where the "session" was a row in `tokens` with no expiry, no revocation and
 * no device record — enough to say a token existed and nothing else.
 */
let sweeper = null;
const idleSweeper = (container) => (sweeper ??= new (require('./auth.service').AuthService)(container));

module.exports = {
  name: 'auth',
  service: 'user',
  basePath: '/auth',
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
  },
  jobs: [
    {
      // Demo accounts whose 30 minutes are up, with everything they made (demoCleanup.js). Every
      // minute, so they are gone right after; a run with nothing expired is one indexed read.
      name: 'auth:purge-demo-accounts',
      intervalMs: Number(process.env.DEMO_PURGE_INTERVAL_MS || 60_000),
      immediate: true,
      run: (container) => require('./demoCleanup').purgeDemoAccounts(container),
    },
    {
      // Idle logout for a closed tab or a client that never calls /idle-check (AuthService.sweepIdleSessions).
      // Off (owner flag or Super Admin switch) → one settings read and nothing else.
      name: 'auth:idle-logout-sweep',
      intervalMs: Number(process.env.IDLE_LOGOUT_SWEEP_INTERVAL_MS || 60_000),
      run: (container) => idleSweeper(container).sweepIdleSessions(),
    },
  ],
};
