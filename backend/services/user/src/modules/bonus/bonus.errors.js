'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('BONUS', {
  INVALID_TYPE: { status: 422, message: 'That is not a valid bonus type' },

  NOT_CLAIMABLE: {
    status: 409,
    message: 'There is no bonus of that type available to claim',
  },
  ALREADY_CLAIMED: { status: 409, message: 'This bonus has already been claimed' },
  EXPIRED: {
    status: 410,
    // Bonuses are awarded by a scheduled job with a deadline. Past it, the
    // player was not quick enough — a different thing from having none.
    message: 'The claim window for this bonus has closed',
  },
  VIP_LEVEL_TOO_LOW: {
    status: 403,
    message: 'Your VIP level is not high enough for this bonus',
  },

  CODE_NOT_FOUND: { status: 404, message: 'That redeem code is not valid' },
  CODE_NOT_ACTIVE: { status: 409, message: 'That redeem code has already been used or has expired' },
  CODE_EXISTS: { status: 409, message: 'A redeem code with that value already exists' },

  NO_BONUS_RECORD: {
    status: 404,
    message: 'This account has no bonus record yet',
  },

  NO_GAME_COUNTERS: {
    status: 404,
    // Granting into counters that do not exist would silently do nothing:
    // `increment` on no rows affects no rows and reports success.
    message: 'This account has no bonus counter record yet',
  },

  EVENT_NOT_FOUND: {
    status: 404,
    message: 'No such bonus log entry',
  },
});
