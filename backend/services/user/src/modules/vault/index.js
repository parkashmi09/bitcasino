'use strict';

/**
 * Vault Pro — fixed-term interest-bearing deposits.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO legacy vaults, and they do not agree. Read this before shipping.
 *
 * `legacy/vaultpro/routes.js` is NEVER MOUNTED — `index.js` does not require
 * it. Its twelve endpoints are dead code: a rich per-deposit model with lock
 * periods, per-term interest rates and maturity dates. That is why its three
 * tables were missing from the schema — the design was never deployed.
 *
 * What is actually LIVE is four inline handlers in `legacy/index.js`:
 *
 *   POST /transfer-in     POST /transfer-out
 *   POST /vault-data      GET  /admin/vault-data
 *
 * They implement a much simpler thing: ONE `vault_pro` row per (userid, coin)
 * that accumulates, with `incomeDate` set to 30 days out and no lock period,
 * no per-deposit rate and no maturity check at all.
 *
 * This module implements the RICHER design — per-deposit, with real lock
 * enforcement — because it is the one the product clearly intended and the one
 * the (now created) schema supports. The observable difference for a client:
 * `transfer-in` returns a deposit id and each transfer is its own locked
 * deposit, where the live version merged everything into a single balance a
 * player could withdraw at any time.
 *
 * If the accumulating behaviour is the one you want, say so — it is a smaller
 * module, not a larger one.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Both legacy versions carried the third SQL injection into the balance table
 * (`UPDATE credits SET ${coin} = ...`) and moved money with raw UPDATEs that
 * wrote no ledger row. Schema comes from migration 010 — partly reconstructed.
 */
module.exports = {
  name: 'vault',
  service: 'user',
  basePath: '/vault',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
  jobs: [
    {
      name: 'vault:accrue-daily-interest',
      intervalMs: Number(process.env.VAULT_ACCRUE_INTERVAL_MS || 60 * 60 * 1000),
      immediate: true,
      run: async (container) => {
        const { VaultService } = require('./vault.service');
        const service = new VaultService(container);
        return service.accrueDailyInterest({
          limit: Number(process.env.VAULT_ACCRUE_BATCH || 500),
        });
      },
    },
  ],
};
