'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('SWAP', {
  SAME_CURRENCY: {
    status: 422,
    message: 'Cannot swap a currency into itself',
  },
  INSUFFICIENT_BALANCE: {
    status: 402,
    message: 'Insufficient balance for this swap',
  },
  RATE_UNAVAILABLE: {
    status: 409,
    message: 'No exchange rate is available for one of these currencies',
  },
  AMOUNT_TOO_SMALL: {
    status: 422,
    // Without this, a swap of 0.00000001 into a currency worth more per unit
    // converts to zero — the player loses the input and receives nothing.
    message: 'The amount is too small to convert into the target currency',
  },
  SWAP_DISABLED: {
    status: 403,
    message: 'Swapping is currently disabled',
  },
});
