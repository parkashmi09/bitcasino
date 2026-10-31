'use strict';

const { response, asyncHandler } = require('@ibitplay/common');
const { canIssueFunds, effectiveStaffLevel, hasPermission, PERMISSIONS } = require('@ibitplay/auth');

/**
 * The actor is `req.staff` — from a verified token — with two capabilities
 * derived from the permissions on that token rather than from a hardcoded
 * level check inside a handler, which is what legacy used
 * (`req.staff.level !== 0`).
 */
function actorFrom(req) {
  const level = effectiveStaffLevel(req.staff);
  return {
    id: req.staff.id,
    // The level this session ACTS with — a level-7 executive row acts with its
    // parent's. Every hierarchy rule in the service compares against this.
    level: Number.isFinite(level) ? level : null,
    executiveId: req.staff.executiveId ?? null,
    canResetOthers: hasPermission(req.staff.permissions, PERMISSIONS.STAFF_WRITE),
    // The platform owner (Super Admin, level 1) funds the tree and has no
    // balance to draw down. This read `level === 0`, which matched nobody.
    canIssueFunds: canIssueFunds(req.staff),
    // `wallet:adjust` moves money with any account in scope; without it a
    // transfer is a parent settling with a direct child staff account, a
    // deposit needing `wallet:credit` and a withdrawal `wallet:debit`.
    canAdjustWallets: hasPermission(req.staff.permissions, PERMISSIONS.WALLET_ADJUST),
    canCredit: hasPermission(req.staff.permissions, PERMISSIONS.WALLET_CREDIT),
    canDebit: hasPermission(req.staff.permissions, PERMISSIONS.WALLET_DEBIT),
    // Set by the auth guard: a session that must change its password may only
    // change its OWN — never reset somebody else's.
    mustChangePassword: Boolean(req.staff.mustChangePassword),
  };
}

function createControllers({ service }) {
  return {
    /** @legacy POST /api/staff/transfer */
    transfer: asyncHandler(async (req, res) =>
      response.created(res, await service.transfer({ ...req.body, actor: actorFrom(req) }))
    ),

    /**
     * @legacy PATCH /api/staff/password
     * @legacy POST /api/staff/reset-password-for-staff
     */
    changePassword: asyncHandler(async (req, res) =>
      response.ok(res, await service.changePassword({ ...req.body, actor: actorFrom(req) }))
    ),
  };
}

module.exports = { createControllers };
