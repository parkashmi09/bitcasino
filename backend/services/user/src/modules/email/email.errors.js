'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('EMAIL', {
  /**
   * One message for "no such account" and for "code did not match".
   *
   * Distinguishing them turns the OTP endpoint into an account-enumeration
   * oracle: an attacker learns which addresses are registered by which error
   * comes back. Legacy answered `User not found` and `Invalid OTP` separately.
   */
  OTP_INVALID: { status: 400, message: 'That code is not valid' },

  OTP_EXPIRED: { status: 410, message: 'That code has expired — request a new one' },
  OTP_TOO_MANY_ATTEMPTS: { status: 429, message: 'Too many incorrect attempts — request a new code' },

  OTP_COOLDOWN: {
    status: 429,
    // Applies to issuing a code, whichever route asked for it. Legacy checked
    // it on `/otp/resend` only, and `/otp/send` deleted the previous code.
    message: 'A code was sent recently — wait before requesting another',
  },

  TWOFA_NOT_ENABLED: { status: 409, message: 'Two-factor authentication is not enabled on this account' },

  SEND_FAILED: { status: 502, message: 'The message could not be sent' },
  NOT_CONFIGURED: { status: 503, message: 'Outbound email is not configured' },

  RECIPIENT_NOT_ALLOWED: {
    status: 403,
    /**
     * `POST /email/send` and `/email/bulk` were UNAUTHENTICATED and took both
     * the recipient and the HTML body from the request. That is an open relay
     * wearing the platform's own sending domain: "your account is locked, click
     * here", from the real casino's address, to its real players. `/email/bulk`
     * made it a mass campaign.
     *
     * They are staff-only now, and a recipient must be a registered player —
     * an operator broadcast is to their own users, never to an arbitrary list.
     */
    message: 'Messages may only be sent to registered players',
  },

  TOO_MANY_RECIPIENTS: { status: 422, message: 'Too many recipients for one send' },
});
