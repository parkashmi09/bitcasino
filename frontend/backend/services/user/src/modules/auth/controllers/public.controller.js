'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { PURPOSE } = require('../../email/email.constants');

/** What an OTP has to have been issued for before it can reset a password. */
const RESET_PASSWORD_PURPOSE = PURPOSE.RESET_PASSWORD;

/**
 * Unauthenticated auth endpoints.
 *
 * Three of them mint a session; `resetPassword` deliberately does not — see
 * its own note below.
 */
function createPublicController({ service, emails }) {
  const context = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

  return {
    register: asyncHandler(async (req, res) => {
      const result = await service.registerAndSignIn(req.body, context(req));
      // 201: the account is new. The session in the body is what makes this
      // one round trip instead of two.
      return response.created(res, result);
    }),

    login: asyncHandler(async (req, res) => {
      const result = await service.login(req.body, context(req));
      return response.ok(res, result);
    }),

    refresh: asyncHandler(async (req, res) => {
      const result = await service.refresh(req.body, context(req));
      return response.ok(res, result);
    }),

    /**
     * Finish a password reset. The one endpoint here that does NOT mint a
     * session.
     *
     * ═══════════════════════════════════════════════════════════════════════
     * IT DELIBERATELY DOES NOT SIGN THE PLAYER IN.
     *
     * `register` answers with a session because creating an account and using
     * it are one intent. A reset is the opposite: the service has just revoked
     * every session on the account, because a reset is what somebody does when
     * they believe it is compromised. Handing back a fresh session in the same
     * response would re-open the door that was just closed — and it would do
     * so for whoever made this call, which on a reset flow is precisely the
     * party whose identity is least established.
     *
     * So it answers `{reset, revokedSessions}` and the client sends the player
     * to the login form with their new password.
     * ═══════════════════════════════════════════════════════════════════════
     *
     * `emails.spendProofWithCode` is passed as a closure rather than the auth
     * service reaching for the email module — the same seam
     * `profile.changeEmail` uses for its own proof.
     */
    resetPassword: asyncHandler(async (req, res) => {
      const { email, code, newPassword } = req.body;

      const result = await service.resetPasswordWithCode({
        newPassword,
        spendProof: () =>
          emails.spendProofWithCode({ email, code, purpose: RESET_PASSWORD_PURPOSE }),
      });

      return response.ok(res, result);
    }),
  };
}

module.exports = { createPublicController };
