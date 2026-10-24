'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  // The address and agent, for the audit trail. Never the password — legacy
  // logged that on the second line of its handler.
  const context = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

  return {
    /** @legacy POST /api/staff/auth/login */
    login: asyncHandler(async (req, res) =>
      response.ok(res, await service.login(req.body, context(req)))
    ),

    /** @legacy POST /api/staff/auth/executive/login */
    executiveLogin: asyncHandler(async (req, res) =>
      response.ok(res, await service.executiveLogin(req.body, context(req)))
    ),

    /** @legacy POST /api/staff/auth/first-login-password */
    firstLoginPassword: asyncHandler(async (req, res) =>
      response.ok(res, await service.firstLoginPassword(req.body, context(req)))
    ),

    /** @legacy POST /api/staff/auth/logout */
    logout: asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.logout(
          { actor: { id: req.staff.id, executiveId: req.staff.executiveId ?? null } },
          context(req)
        )
      )
    ),

    /**
     * Second-factor enrolment for the CALLER'S OWN account.
     *
     * `req.staff.id` in every case — from the verified token, never from the
     * body or the path. There is no staff id parameter on any of these, which
     * is what makes "act on someone else's second factor" unexpressible rather
     * than merely rejected.
     */
    twoFactorStatus: asyncHandler(async (req, res) =>
      response.ok(res, await service.twoFactorStatus(req.staff.id))
    ),

    beginTwoFactor: asyncHandler(async (req, res) =>
      response.ok(res, await service.beginTwoFactor(req.staff.id))
    ),

    confirmTwoFactor: asyncHandler(async (req, res) =>
      response.ok(res, await service.confirmTwoFactor(req.staff.id, req.body))
    ),

    disableTwoFactor: asyncHandler(async (req, res) =>
      response.ok(res, await service.disableTwoFactor(req.staff.id, req.body))
    ),
  };
}

module.exports = { createControllers };
