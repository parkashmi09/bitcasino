'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { PURPOSE: EMAIL_PURPOSE } = require('../../email/email.constants');

function createControllers({ service, emails }) {
  return {
    get: asyncHandler(async (req, res) => response.ok(res, await service.get(req.user.id))),

    /** Pick one of the operator's avatars (VIP-level gated). */
    setAvatar: asyncHandler(async (req, res) => response.ok(res, await service.setAvatar(req.user.id, req.body.avatarId))),

    /** @legacy PUT /editProfile */
    update: asyncHandler(async (req, res) => response.ok(res, await service.update(req.user.id, req.body))),

    /**
     * @legacy GET /get-referral-code/:uid
     * @legacy GET /get-referral-link/:uid
     */
    referral: asyncHandler(async (req, res) => response.ok(res, await service.getReferral(req.user.id))),

    /**
     * Change the account's e-mail address.
     *
     * TWO STEPS, NOT ONE, and the split is the whole security property: the
     * code is VERIFIED here and the proof is SPENT inside `changeEmail`, so one
     * verification authorises exactly one change. Collapsing them would let a
     * single code be replayed. This is the same shape `EDIT_ACCOUNT` uses in
     * `profile/sockets.js`, which until now was the only caller — the service
     * method was written, tested and unreachable over HTTP.
     *
     * The code is checked against the NEW address, not the current one: the
     * question being answered is "can this person receive mail there", because
     * that is where password reset will deliver afterwards.
     */
    changeEmail: asyncHandler(async (req, res) => {
      const { email, code } = req.body;

      await emails.verifyOtp({ email, code, purpose: EMAIL_PURPOSE.CHANGE_EMAIL });

      const profile = await service.changeEmail(req.user.id, {
        email,
        proveEmail: ({ email: address }) =>
          emails.spendProof({ email: address, purpose: EMAIL_PURPOSE.CHANGE_EMAIL }),
      });

      return response.ok(res, profile);
    }),

    /** Another player's profile — gap 17. No token needed; see the service. */
    publicProfile: asyncHandler(async (req, res) =>
      response.ok(res, await service.publicProfile(req.params.userId))
    ),

    /** @legacy GET /verify-referral-code/:referralCode */
    verifyReferralCode: asyncHandler(async (req, res) =>
      response.ok(res, await service.verifyReferralCode(req.params.referralCode))
    ),
  };
}

module.exports = { createControllers };
