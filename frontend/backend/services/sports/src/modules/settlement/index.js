'use strict';

/**
 * Settlement module manifest.
 *
 * This is the whole contract between a module and its host process. The module
 * declares what it is and which audiences it serves; the host decides where
 * that lands and what each audience must prove.
 *
 * Because nothing here names a port, a prefix or a guard, the same folder runs
 * unchanged in three places:
 *
 *   - sports-service          (microservices mode)
 *   - the combined app        (modular-monolith mode, `npm run dev:mono`)
 *   - the sports worker       (routers ignored, `jobs` mounted instead)
 *
 * Replaces `legacy/mannualsettlement/` — see `docs/MICROSERVICES-BLUEPRINT.md`
 * §3.4 for the full old-path -> new-path table.
 */
module.exports = {
  name: 'settlement',
  service: 'sports',
  basePath: '/settlement',

  /** Database domains this module reads or writes. */
  models: ['sports', 'core'],

  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },

  /**
   * Automatic settlement, ported from the two standalone legacy crons.
   *
   * These run in the SPORTS WORKER, not in the HTTP service — `worker.js`
   * collects `jobs` from every module and the HTTP service ignores them.
   *
   *   settlement:results  60s  legacy/sportsmain/cron/job.js
   *                            open/manual bets → result feed → queue a job
   *   settlement:payout   60s  legacy/sportsmain/cron/settlement.js
   *                            queue → resolve winner → pay, close, clear exposure
   *
   * Two jobs and not one because that is the shape the queue table encodes:
   * the scanner decides WHAT is settleable and stamps `SportsBet.job_id`, the
   * payout worker is the only thing that moves money. A bet with no `job_id` is
   * invisible to settlement — which is the state every open bet was in until
   * these were wired up, since neither cron survived the service split.
   *
   * NOT `immediate`: unlike the feed pair, nothing here is a cache warm-up, and
   * a settlement pass firing during boot — before the process is known healthy
   * — is a poor trade for sixty seconds.
   */
  jobs: [
    {
      name: 'settlement:results',
      intervalMs: require('../../config').SPORTS_RESULT_POLL_MS,
      run: (container) => runOnce('results', container),
    },
    {
      name: 'settlement:payout',
      intervalMs: require('../../config').SPORTS_SETTLEMENT_INTERVAL_MS,
      run: (container) => runOnce('payout', container),
    },
  ],
};

/**
 * Build each job's closure ONCE and reuse it across ticks.
 *
 * Not a micro-optimisation: both closures own a `ResultsClient`, and that
 * client holds the shared rate-limit clock and the concurrency queue. Rebuilding
 * it per tick — which is what calling the factory inside `run` would do — resets
 * `lastApiCallAt` every minute and hands the provider an unthrottled burst.
 */
const built = new Map();

function runOnce(which, container) {
  if (!built.has(which)) {
    built.set(
      which,
      which === 'results'
        ? require('./settlement.results.job').createResultsJob(container)
        : require('./settlement.payout.job').createPayoutJob(container)
    );
  }
  return built.get(which)();
}
