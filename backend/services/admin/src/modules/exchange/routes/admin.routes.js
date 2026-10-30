'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds } = require('@ibitplay/auth');

const v = require('../exchange.validators');
const { ExchangeService } = require('../exchange.service');

/** Login wala staff — owner hai ya nahi (`canIssueFunds`) bhi saath me. */
const actorFrom = (req) => ({
  id: req.staff.id,
  level: req.staff.level,
  executiveId: req.staff.executiveId ?? null,
  canIssueFunds: canIssueFunds(req.staff),
});

/**
 * Exchange section — admin panel ke "Exchange" menu ke routes.
 *
 *   GET  /admin/exchange/dashboard          upar ke cards
 *   GET  /admin/exchange/owner/wallet       owner ka wallet (Add Balance popup ka Current Balance)
 *   POST /admin/exchange/owner/add-balance  owner apne Agent System balance (credits) me add kare
 *   POST /admin/exchange/owner/add-direct-balance  owner apne Direct User balance (staff_balances) me add kare
 *   POST /admin/exchange/owner/move-to-agent-system whitelabel company: Direct User balance → Agent System balance
 *   GET  /admin/exchange/owner/direct-ledger       us Direct User wallet ka ledger (har badlav, pehle / baad ka balance)
 *   GET  /admin/exchange/accounts           direct children (Account List / Active Users / Bank)
 *   POST /admin/exchange/points/settle      points settlement (D / W, Bank submit)
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new ExchangeService(deps);
  const router = Router();

  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  // Wallet dekhne ki koi bhi permission chalegi (jaise /accounts/float).
  const canSeeWallets = auth.requireAnyPermission(
    PERMISSIONS.WALLET_CREDIT, PERMISSIONS.WALLET_DEBIT, PERMISSIONS.WALLET_ADJUST, PERMISSIONS.USERS_READ
  );

  router.get(
    '/dashboard',
    canSeeWallets,
    asyncHandler(async (req, res) => response.ok(res, await service.dashboard({ actor: actorFrom(req) })))
  );

  router.get(
    '/owner/wallet',
    canSeeWallets,
    asyncHandler(async (req, res) => response.ok(res, await service.ownerWallet({ actor: actorFrom(req) })))
  );

  // Owner ka "Add balance" — paisa yahin se system me aata hai, isliye audit hota hai.
  router.post(
    '/owner/add-balance',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
    validate(v.ownerAddBalance),
    withActivity({
      action: 'exchange.owner.add-balance',
      describe: (req) => ({ targetType: 'STAFF', targetId: req.staff.id, details: { amount: req.body.amount, note: req.body.note } }),
    }),
    asyncHandler(async (req, res) =>
      response.created(res, await service.ownerAddBalance({ ...req.body, actor: actorFrom(req) }))
    )
  );

  // Owner ka Direct User balance — direct users ko dena isi se hota hai.
  router.post(
    '/owner/add-direct-balance',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
    validate(v.ownerAddDirectBalance),
    withActivity({
      action: 'exchange.owner.add-direct-balance',
      describe: (req) => ({ targetType: 'STAFF', targetId: req.staff.id, details: { amount: req.body.amount, currency: req.body.currency, note: req.body.note } }),
    }),
    asyncHandler(async (req, res) =>
      response.created(res, await service.ownerAddDirectBalance({ ...req.body, actor: actorFrom(req) }))
    )
  );

  // Whitelabel company (WHITELABEL_MODE): parent ka bheja Direct balance agents ke liye Agent System me.
  router.post(
    '/owner/move-to-agent-system',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
    validate(v.ownerMoveToAgentSystem),
    withActivity({
      action: 'exchange.owner.move-to-agent-system',
      describe: (req) => ({ targetType: 'STAFF', targetId: req.staff.id, details: { amount: req.body.amount, note: req.body.note } }),
    }),
    asyncHandler(async (req, res) =>
      response.created(res, await service.ownerMoveToAgentSystem({ ...req.body, actor: actorFrom(req) }))
    )
  );

  // Owner ke Direct User wallet ka ledger (Add Balance, direct user ko diya / liya, points settle).
  router.get(
    '/owner/direct-ledger',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
    validate(v.directLedger),
    asyncHandler(async (req, res) => {
      const { limit, offset, from, to } = req.query;
      const result = await service.ownerDirectLedger({ actor: actorFrom(req), limit, offset, from, to });
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  // Zip ka users/all-details — Account List, Active Users aur Bank teeno isi se.
  router.get(
    '/accounts',
    canSeeWallets,
    validate(v.accounts),
    asyncHandler(async (req, res) => {
      const { limit, offset, parentId, search, channel, accountType } = req.query;
      const result = await service.accounts({ actor: actorFrom(req), parentId, search, channel, accountType, limit, offset });
      return response.ok(res, {
        rows: result.rows,
        me: result.me,
        pagination: { page: Math.floor(offset / limit) + 1, limit, total: result.total },
      });
    })
  );

  // Zip ka wallet/points/settle — D / W buttons aur Bank ka Submit.
  router.post(
    '/points/settle',
    auth.requireAnyPermission(PERMISSIONS.WALLET_CREDIT, PERMISSIONS.WALLET_DEBIT, PERMISSIONS.WALLET_ADJUST),
    validate(v.settle),
    withActivity({
      action: 'exchange.points.settle',
      describe: (req) => ({
        targetType: req.body.accountType === 'staff' ? 'STAFF' : 'USER',
        targetId: req.body.accountId,
        details: { points: req.body.points, remark: req.body.remark },
      }),
    }),
    asyncHandler(async (req, res) => response.ok(res, await service.settle({ ...req.body, actor: { ...actorFrom(req), permissions: req.staff.permissions } })))
  );

  // Zip ka ledger/user/history — Credit Activity / More modal ka "Credit History".
  router.get(
    '/credit-history',
    canSeeWallets,
    validate(v.creditHistory),
    asyncHandler(async (req, res) => {
      const { limit, offset, accountType, accountId } = req.query;
      const result = await service.creditHistory({ actor: actorFrom(req), accountType, accountId, limit, offset });
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  return router;
};
