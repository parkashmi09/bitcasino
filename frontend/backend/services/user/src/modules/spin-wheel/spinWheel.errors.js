'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('SPIN', {
  DISABLED: { status: 503, message: 'The spin wheel is currently disabled' },
  NO_SLICES: { status: 503, message: 'The spin wheel has no prizes configured' },

  INVALID_WEIGHTS: {
    status: 503,
    /**
     * A wheel whose weights sum to zero has no valid draw.
     *
     * Legacy returned slice 0 in this case, which turns a misconfiguration into
     * a wheel that always lands on the same prize — silently, and in whichever
     * direction happened to be first in `sort_order`.
     */
    message: 'The spin wheel is not correctly configured',
  },

  SLICE_NOT_FOUND: { status: 404, message: 'That wheel segment does not exist' },

  COOLDOWN_ACTIVE: { status: 429, message: 'You cannot spin again yet' },
  DEPOSIT_REQUIRED: {
    status: 403,
    message: 'A qualifying deposit is required before spinning again',
  },
});
