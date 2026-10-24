'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('BANK_DETAILS', {
  NOT_FOUND: {
    status: 404,
    message: 'Payment details not found',
  },
  UNSUPPORTED_COIN: {
    status: 422,
    message: 'This currency is not supported for deposits',
  },
  INVALID_QR: {
    status: 422,
    message: 'The QR image must be a JPEG or PNG under 2 MB',
  },
});
