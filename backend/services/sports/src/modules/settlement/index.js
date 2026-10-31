'use strict';

const path = require('path');

/**
 * Settlement: manual settle for the owner, and the two workers that settle automatically.
 *
 *   controllers/          manualSettleController (mssports `mannualSettle/controller.js`)
 *   services/             settlementQueue (job rows + Redis wake), autoVoid, voidAuditService,
 *                         sportsMarketVoidService, sportsVoidService, sportsCommissionService
 *   workers/results       polls the results API every 2 s, queues `sports_event_settlement_jobs`
 *                         (TENEXCH pm2 undefined-sports-results-cron, newjobv2.js)
 *   workers/settlement    claims jobs and pays out: Wallets, credits_ledger, point_ledger chain,
 *                         commission (TENEXCH pm2 undefined-sports-settlement-worker, settlementv2.js)
 *
 * The settlement worker must run as EXACTLY ONE process (`WORKER_MODE=1`) — its duplicate-payout
 * protection assumes it (mssports PENDING_WORK A4). src/worker.js runs one of each.
 *
 * Routes are mssports' `/api/internalsettle`, under `/api/v1/admin/sports/internalsettle`; the
 * gateway keeps the TENEXCH paths. Owner only — mssports' `requireOwner` on every route.
 */
const LOG_DIR = () => require('../../config').MSSPORTS_LOG_DIR;

module.exports = {
  name: 'settlement',
  service: 'sports',
  basePath: '/internalsettle',

  routers: {
    admin: require('./routes/admin.routes'),
  },

  // The environment TENEXCH's pm2 ecosystem gave each worker (secrets and hosts come from .env).
  workers: [
    {
      name: 'results',
      script: path.join(__dirname, 'workers/results/results.worker.mjs'),
      maxRestarts: 10,
      env: () => ({
        DEBUG: '0', SETTLEMENT_VERSION: 'v2',
        API_TIMEOUT_MS: '40000', MAX_CONCURRENT_API: '3', RESULTS_POLL_MS: '2000',
        RESULT_CACHE_MS: '1500', SCAN_WRITE_MS: '60000', SUMMARY_KEEP_PER_EVENT: '5',
        SUMMARY_RETENTION_DAYS: '7', BET_CACHE_TTL_DAYS: '14',
        RESULTS_CRON_LOG_DIR: LOG_DIR(),
      }),
    },
    {
      // ONE instance only — duplicate-settlement protection assumes it.
      name: 'settlement',
      script: path.join(__dirname, 'workers/settlement/settlement.worker.mjs'),
      maxRestarts: 10,
      env: () => ({
        DEBUG: '1', WORKER_MODE: '1', SETTLEMENT_VERSION: 'v2',
        API_TIMEOUT_MS: '15000', SETTLE_POLL_MS: '3000', SETTLE_BATCH_LIMIT: '100',
        SETTLE_REQUEUE_MS: '20000', SETTLE_STUCK_MS: '180000', RESULT_CACHE_MS: '2500',
        LEDGER_ZERO_ROWS: '0', SETTLEMENT_LOG_DIR: LOG_DIR(),
      }),
    },
  ],
};
