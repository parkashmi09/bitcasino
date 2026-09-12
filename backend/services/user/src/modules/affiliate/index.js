'use strict';

/**
 * The referral programme.
 *
 * Two money defects, both reachable without a token:
 *
 *   `POST /affiliate/process-wager` chose the reward tier from a `wagerAmount`
 *   in the REQUEST BODY. Posting the top tier minted a $500 reward, claimable
 *   into a balance. The unlock here reads the member's wager from `userwager`
 *   and has no parameter for it.
 *
 *   Claiming was select-then-unconditional-update, so `claim-reward` and
 *   `claim-reward-all` running together paid the same reward twice.
 *
 * And one privacy defect: `GET /affiliate/team/:referralCode` returned the
 * named player's whole downline including email addresses, keyed on a code that
 * is meant to be shared publicly.
 */
module.exports = {
  name: 'affiliate',
  service: 'user',
  basePath: '/affiliate',
  models: ['core'],
  routers: {
    user: require('./routes/user.routes'),
    admin: require('./routes/admin.routes'),
  },
};
