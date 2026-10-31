'use strict';

/**
 * The VIP ladder, and where a player stands on it.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * GAP 4 ASKED FOR A LADDER TABLE. THERE ALREADY IS A LADDER.
 *
 * `packages/common/src/vipLevels.js` holds all 75 bands — level, `minXp`,
 * `maxXp` and the card tier — lifted verbatim from `legacy/bonus/calculateVip.js`
 * so a transcription slip could not move a player between levels. And
 * `vipLevelFor(wager)` already returns exactly what a player's own view needs:
 * level, card, wager, next level, wager to next level and a progress
 * percentage.
 *
 * So this module adds NO migration and NO computation. `bonus.service.js` has
 * been calling `vipLevelFor` since the port and returning it INSIDE the bonus
 * payload; what was missing was a way to ask for the ladder at all, and a way
 * to ask for a player's standing without also fetching every bonus type.
 *
 * ── THE PATHS ARE NOT THE ONES GAP 4 PROPOSED ────────────────────────────
 *
 * It suggested `GET /vip/levels` and `GET /user/vip`. Every route on this
 * service mounts under `/api/v1/user/`, whatever the audience — `auth`'s public
 * router puts login at `/api/v1/user/auth/login` — so a bare `/vip/levels` is
 * not reachable from here. `GET /user/vip/levels` is the same resource under
 * the prefix the service actually owns.
 *
 * The ladder is on the PUBLIC router: it is identical for everyone ON THIS
 * SITE and a signed-out visitor looking at the VIP page needs it. A player's
 * own standing is on the user router.
 *
 * ── WHICH LADDER ─────────────────────────────────────────────────────────
 *
 * The site's `vip` feature variant names it — `addaplay` runs the 75-band
 * ladder, everything else the platform's 41 — and `resolveVipLadder` reads
 * that choice on every request. Both routes publish `ladder` so a front end
 * can tell which one it was sent.
 */
module.exports = {
  name: 'vip',
  service: 'user',
  basePath: '/vip',
  /* `core` for `Userwager`; `extended` for `SiteFeature`, which names the ladder this site runs. */
  models: ['core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
    /**
     * casino-service posts here after every stake that moves `userwager`, so
     * the rakeback rate and the level/rank-up credits follow the ladder the
     * player actually holds. The file existed and was never listed, which is
     * indistinguishable from the route not existing: the caller wraps it in a
     * `try/catch` that only warns, so a 404 here stopped VIP progression
     * without stopping — or reporting — anything else.
     */
    internal: require('./routes/internal.routes'),
  },
  /**
   * Run by `worker.js`, not by the HTTP service — the same separation the race
   * jobs use, and for the first of their reasons: this must run ONCE. Two HTTP
   * instances sweeping would be two passes competing for the same row locks.
   *
   * Every fifteen minutes because an award is a CONDITION — "the period has
   * rolled and nothing has been written for it" — not an event at a fixed
   * hour. A worker that was down at midnight catches up on its next tick
   * instead of skipping a day, and a player who opens the VIP page in the
   * meantime has their awards materialised by `overview` anyway. This is the
   * backstop for everyone who does not.
   */
  jobs: [
    {
      name: 'vip:award-periodic',
      intervalMs: 15 * 60_000,
      immediate: true,
      run: (container) => require('./vip.jobs').createAwardPeriodicJob(container)(),
    },
  ],
};
