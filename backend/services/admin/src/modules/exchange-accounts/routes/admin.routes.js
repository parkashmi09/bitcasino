'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds, effectiveStaffLevel, hasPermission } = require('@ibitplay/auth');

const v = require('../exchangeAccounts.validators');
const { CreateAccountService } = require('../createAccount');

/** StaffService wala actor (staff/controllers ka actorFrom jaisa). */
const staffActorFrom = (req) => {
  const level = effectiveStaffLevel(req.staff);
  return {
    id: req.staff.id,
    level: Number.isFinite(level) ? level : null,
    executiveId: req.staff.executiveId ?? null,
    permissions: req.staff.permissions,
    canIssueFunds: canIssueFunds(req.staff),
    canAdjustWallets: hasPermission(req.staff.permissions, PERMISSIONS.WALLET_ADJUST),
    canCredit: hasPermission(req.staff.permissions, PERMISSIONS.WALLET_CREDIT),
    canDebit: hasPermission(req.staff.permissions, PERMISSIONS.WALLET_DEBIT),
  };
};

/**
 * Sports Exchange — Account wale screens (zip msadmin):
 *
 *   GET    /check-username                 Create Account: naam khali hai?
 *   POST   /create                         Create Account
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const accounts = new CreateAccountService(deps);
  const router = Router();

  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });
  const audit = (action, describe) => withActivity({ action, describe });

  const canCreate = auth.requireAnyPermission(PERMISSIONS.USERS_WRITE, PERMISSIONS.STAFF_WRITE);
  const ok = (fn) => asyncHandler(async (req, res) => response.ok(res, await fn(req, res)));

  // ── Create Account ──────────────────────────────────────────────────
  router.get('/check-username', canCreate, validate(v.checkUsername), ok((req) => accounts.checkUsername(req.query.username)));

  router.post(
    '/create',
    canCreate,
    validate(v.createAccount),
    audit('exchange.account.create', (req) => ({
      targetType: req.body.userType === 'USER' ? 'USER' : 'STAFF',
      details: { username: req.body.username, userType: req.body.userType, creditAmount: req.body.creditAmount ?? '0' },
    })),
    asyncHandler(async (req, res) =>
      response.created(res, await accounts.create({ ...req.body, staffActor: staffActorFrom(req), playerActor: req.staff }))
    )
  );

  // System Tracker ab sirf owner panel me — module `owner-system-tracker` (x-owner-key).

  return router;
};
