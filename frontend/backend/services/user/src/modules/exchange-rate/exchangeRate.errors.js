'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('EXCHANGE_RATE', {
  RATE_NOT_FOUND: {
    status: 404,
    message: 'No exchange rate is configured for this currency',
  },
  RATE_ALREADY_EXISTS: {
    status: 409,
    message: 'An exchange rate already exists for this currency',
  },
  INVALID_RATE: {
    status: 422,
    message: 'The rate must be greater than zero',
  },
  RATE_IN_USE: {
    status: 409,
    message: 'This currency still holds player balances and cannot be removed',
  },
});
