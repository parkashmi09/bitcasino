'use strict';

/**
 * The wagering race — a daily and a weekly leaderboard paid from a prize pool.
 *
 * Bets become points, points become ranks, ranks become claimable prizes. The
 * turnover comes from casino-service and sports-service over their internal
 * APIs; the pricing, the multipliers, the prize curve and the payout live here,
 * because user-service is the only service that writes a balance.
 *
 * ── WHY THE ROUTES ARE SPLIT THREE WAYS ──────────────────────────────────
 *
 *   public  the board and the configuration. A visitor has to see the prize
 *           pool and the standings before deciding to open an account, and
 *           neither exposes anything about a player beyond a display name.
 *   user    a player's own prizes, and claiming them. Money.
 *   admin   the configuration, the settled races, and the decorative entries.
 *
 * The reference had all of it on one unauthenticated router with `user_id`
 * taken from the request body — so anyone could read anyone's prizes, and the
 * claim endpoint took the account to credit as a parameter.
 */
module.exports = {
  name: 'race',
  service: 'user',
  basePath: '/race',
  /**
   * `core` for `users` and `exchangerate`, `extended` for the four race tables
   * (migration 039). Casino and sports turnover is NOT read from their tables —
   * it comes over the internal API, which is what stops a fifth copy of "how
   * much has this player wagered" appearing on the platform.
   */
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },

  /**
   * Run by `services/user/src/worker.js`, not by the HTTP service.
   *
   * A settlement builds two full leaderboards and writes every prize; sharing
   * an event loop with request handling would put sign-ins behind it. It also
   * has to run ONCE — four HTTP instances would mean four settlement loops
   * racing each other, which the unique constraints survive but should not
   * have to.
   */
  jobs: [
    {
      /**
       * Every five minutes, not at midnight.
       *
       * A roll is a condition — "the open window has ended" — not an event, so
       * a worker that was down at midnight settles late and catches up rather
       * than skipping a day. See `race.jobs.js`.
       */
      name: 'race:roll',
      intervalMs: 5 * 60_000,
      immediate: true,
      run: (container) => require('./race.jobs').createRollJob(container)(),
    },
    {
      name: 'race:boats',
      // Every minute: a booked seat must follow the board as players climb past it.
      intervalMs: 60_000,
      run: (container) => require('./race.jobs').createBoatJob(container)(),
    },
  ],
};
