'use strict';

/**
 * Sports turnover reporting.
 *
 * The sports half of the pair — see `services/casino/src/modules/wager-report`
 * for why reward features ask for this rather than reading the tables.
 *
 * Internal-only, for the same reason: another player's exact turnover is both
 * private and useful to anyone probing a bonus condition.
 */
module.exports = {
  name: 'wager-report',
  service: 'sports',
  basePath: '/wager',
  models: ['sports'],
  routers: {
    internal: require('./routes/internal.routes'),
  },
  /**
   * Settled sports stakes into `userwager` (Rollover, VIP, rakeback, admin wager) and voided
   * ones back out — see `sportsWagerSync.js`. Runs in sports-worker; exactly-once per bet.
   */
  jobs: [
    {
      name: 'wager:sports-sync',
      intervalMs: Number(process.env.SPORTS_WAGER_SYNC_INTERVAL_MS || 60 * 1000),
      run: async (container) => {
        const { SportsWagerSync } = require('./sportsWagerSync');
        return new SportsWagerSync(container).run();
      },
    },
  ],
};
