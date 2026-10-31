'use strict';

/**
 * One-time codes and outbound player email.
 *
 *   `POST /send-otp` RETURNED THE CODE IN ITS OWN RESPONSE. Unauthenticated,
 *   sent to any address in the body, with `support@camelbit.games` /
 *   `camelbit@123` in the source. A code the requester is handed is not a
 *   second factor.
 *
 *   `POST /email/send` AND `/email/bulk` WERE AN OPEN RELAY — unauthenticated,
 *   with both the recipient and the HTML taken from the request.
 *
 *   THE ATTEMPT LIMIT COULD NEVER BE REACHED. `/otp/send` had no cooldown and
 *   deleted the outstanding code before issuing a new one, so asking again
 *   bought three more guesses and sent another email.
 *
 *   REGISTRATION CODES WERE IMPOSSIBLE. `user_otps.email` had a foreign key to
 *   `users(email)`, so a code for an address with no account yet violated it
 *   on insert. Migration 018 drops it.
 *
 *   THE ERRORS WERE AN ENUMERATION ORACLE — `User not found`, `2FA is not
 *   enabled` and success were three distinguishable answers on an
 *   unauthenticated route.
 *
 *   `expires_at` WAS WRITTEN AND THEN IGNORED, with the deadline recomputed
 *   from `created_at` at verification time.
 *
 * The `support@camelbit.games` password is in the repository history. Rotate it.
 */
module.exports = {
  name: 'email',
  service: 'user',
  basePath: '/email',
  models: ['core'],
  routers: {
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
  },
};
