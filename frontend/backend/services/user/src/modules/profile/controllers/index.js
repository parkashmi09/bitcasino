'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    get: asyncHandler(async (req, res) => response.ok(res, await service.get(req.user.id))),

    /** @legacy PUT /editProfile */
    update: asyncHandler(async (req, res) => response.ok(res, await service.update(req.user.id, req.body))),

    /**
     * @legacy GET /get-referral-code/:uid
     * @legacy GET /get-referral-link/:uid
     */
    referral: asyncHandler(async (req, res) => response.ok(res, await service.getReferral(req.user.id))),

    /** @legacy GET /verify-referral-code/:referralCode */
    verifyReferralCode: asyncHandler(async (req, res) =>
      response.ok(res, await service.verifyReferralCode(req.params.referralCode))
    ),
  };
}

module.exports = { createControllers };
