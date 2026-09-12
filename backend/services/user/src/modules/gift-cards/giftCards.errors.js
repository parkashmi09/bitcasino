'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('GIFTCARD', {
  NOT_FOUND: { status: 404, message: 'Gift card not found' },
  KEY_TAKEN: { status: 409, message: 'A gift card with this key already exists' },
  INACTIVE: { status: 410, message: 'This gift card is no longer available' },
  EXPIRED: { status: 410, message: 'This gift card has expired' },

  NOT_ELIGIBLE: {
    status: 403,
    message: 'This gift card is not available to your account',
  },
  ALREADY_ACTIVATED: { status: 409, message: 'You have already activated this gift card' },
  NOT_ACTIVATED: { status: 409, message: 'Activate this gift card before claiming it' },
  ALREADY_CLAIMED: { status: 409, message: 'This gift card has already been claimed' },

  DEPOSIT_CONDITION_UNMET: {
    status: 409,
    message: 'The deposit condition for this gift card has not been met',
  },
  WAGER_CONDITION_UNMET: {
    status: 409,
    message: 'The wagering condition for this gift card has not been met',
  },

  RATE_UNAVAILABLE: {
    status: 503,
    // Conditions are denominated in USD but deposits arrive in many currencies.
    // Without a rate the condition cannot be evaluated, and guessing it either
    // pays out a card that was not earned or refuses one that was.
    message: 'No exchange rate is available to evaluate this gift card',
  },

  IN_USE: {
    status: 409,
    message: 'Players have already activated this gift card, so it cannot be deleted',
  },
});
