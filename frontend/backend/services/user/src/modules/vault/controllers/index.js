'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    /** @legacy GET /vaultpro/lock-options */
    lockOptions: asyncHandler(async (_req, res) => response.ok(res, await service.listLockOptions())),

    /**
     * @legacy POST /transfer-in
     * @legacy POST /vaultpro/transfer-in
     */
    transferIn: asyncHandler(async (req, res) =>
      response.created(res, await service.transferIn({ ...req.body, userId: req.user.id }))
    ),

    /**
     * @legacy POST /transfer-out
     * @legacy POST /vaultpro/transfer-out
     */
    transferOut: asyncHandler(async (req, res) =>
      response.ok(res, await service.transferOut({ ...req.body, userId: req.user.id }))
    ),

    /**
     * @legacy POST /vault-data
     * @legacy POST /vaultpro/vault-data
     */
    vaultData: asyncHandler(async (req, res) =>
      response.ok(res, await service.getVaultData({ userId: req.user.id, coin: req.query.coin }))
    ),

    /** @legacy POST /vaultpro/history */
    interestHistory: asyncHandler(async (req, res) =>
      response.paginated(res, await service.listInterest({ ...req.query, userId: req.user.id }), page(req.query))
    ),

    /** @legacy POST /vaultpro/transactions */
    transactions: asyncHandler(async (req, res) =>
      response.paginated(res, await service.listTransactions({ ...req.query, userId: req.user.id }), page(req.query))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy POST /vaultpro/admin/add-lock-period */
    addLockPeriod: asyncHandler(async (req, res) => response.created(res, await service.addLockPeriod(req.body))),

    /** @legacy POST /vaultpro/admin/update-interest */
    updateRate: asyncHandler(async (req, res) => response.ok(res, await service.updateRate(req.body))),

    /** @legacy POST /vaultpro/admin/delete-lock-period */
    deleteLockPeriod: asyncHandler(async (req, res) => response.ok(res, await service.deleteLockPeriod(req.body))),

    /**
     * @legacy GET /admin/vault-data
     * @legacy GET /vaultpro/admin/vault/users
     */
    users: asyncHandler(async (req, res) =>
      response.paginated(res, await service.listVaultUsers(req.query), page(req.query))
    ),

    /** @legacy GET /vaultpro/admin/vault/stats */
    stats: asyncHandler(async (_req, res) => response.ok(res, await service.stats())),

    /** @legacy GET /vaultpro/admin/vault/interest-history */
    allInterest: asyncHandler(async (req, res) =>
      response.paginated(res, await service.listAllInterest(req.query), page(req.query))
    ),
  };
}

module.exports = { createControllers };
