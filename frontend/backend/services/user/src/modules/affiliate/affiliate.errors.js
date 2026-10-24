'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('AFFILIATE', {
  USER_NOT_FOUND: { status: 404, message: 'Player not found' },
  NO_REFERRAL_CODE: { status: 404, message: 'This account has no referral code' },

  MEMBER_NOT_FOUND: { status: 404, message: 'That player is not on your team' },
  ALREADY_ON_TEAM: { status: 409, message: 'That player is already on a team' },
  CANNOT_REFER_SELF: {
    status: 422,
    // Otherwise a player refers themselves and earns commission on their own
    // wagering — which legacy permitted, since it only matched names.
    message: 'You cannot add yourself to your own team',
  },
  INVALID_REFERRAL_CODE: { status: 404, message: 'That referral code is not valid' },

  REWARD_NOT_FOUND: { status: 404, message: 'Reward not found' },
  ALREADY_CLAIMED: { status: 409, message: 'This reward has already been claimed' },
  NOTHING_TO_CLAIM: { status: 409, message: 'You have no rewards to claim' },

  NOT_YOUR_REWARD: {
    status: 404,
    // 404 rather than 403: telling a caller that a reward exists but is not
    // theirs confirms the id is real.
    message: 'Reward not found',
  },
});
