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
  CRYPTO_ADDRESS_INVALID: {
    status: 422,
    message: 'The crypto receiving address is not valid for this network',
  },
  NETWORK_NOT_ENABLED: {
    status: 422,
    message: 'This network is not enabled for the coin',
  },
  AMOUNT_RANGE_INVALID: {
    status: 422,
    message: 'The minimum amount cannot be above the maximum',
  },
  INVALID_QR: {
    status: 422,
    message: 'The QR image must be a JPEG or PNG under 2 MB',
  },
});
