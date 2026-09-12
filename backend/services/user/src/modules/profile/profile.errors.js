'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('PROFILE', {
  USER_NOT_FOUND: {
    status: 404,
    message: 'Account not found',
  },
  USERNAME_TAKEN: {
    status: 409,
    message: 'That username is already in use',
  },
  USERNAME_LOCKED: {
    status: 403,
    message: 'Your username cannot be changed. Contact support.',
  },
  NO_REFERRAL_CODE: {
    status: 404,
    message: 'No referral code has been issued for this account',
  },

  EMAIL_TAKEN: {
    status: 409,
    /**
     * Legacy's check was off by one:
     *
     *     Rule.getUserInfoByEmail(email, (result) => {
     *       result = _.toArray(result);
     *       if (result.length > 1) return callback({error: "Email already was taken."});
     *       else UPDATE users SET email = $1 ...
     *
     * One existing account with that address gives `length === 1`, which is
     * not `> 1` — so the update ran and TWO accounts ended up on one address.
     * Password reset then delivers to an address two people can claim.
     */
    message: 'That email address is already in use',
  },

  EMAIL_NOT_VERIFIED: {
    status: 403,
    // Legacy wrote the new address with no proof anyone could read mail there.
    message: 'Verify the new email address with a code before changing it',
  },

  EMAIL_UNCHANGED: {
    status: 400,
    message: 'That is already the email address on this account',
  },

  NOT_FOUND: {
    status: 404,
    /**
     * One code for "no such thing" and "not yours" — otherwise the endpoint
     * confirms which ids exist. Legacy's read handlers took the id from the
     * message and had no guard at all, so the question never arose.
     */
    message: 'Not found',
  },
});
