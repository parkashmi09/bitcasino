'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('PSP', {
  UNKNOWN_PROVIDER: { status: 404, message: 'Unknown payment provider' },
  PROVIDER_DISABLED: { status: 503, message: 'This payment provider is currently unavailable' },

  INVALID_SIGNATURE: {
    status: 401,
    // Deliberately vague to the caller. A genuine provider never sees this, and
    // an attacker probing the callback learns nothing about why it failed.
    message: 'Callback rejected',
  },
  TRANSACTION_NOT_FOUND: { status: 404, message: 'Transaction not found' },
  AMOUNT_MISMATCH: {
    status: 409,
    message: 'The callback amount does not match the recorded transaction',
  },
  ALREADY_SETTLED: { status: 409, message: 'This transaction has already been settled' },
  PAYLOAD_REPLAYED: {
    status: 409,
    // A genuine provider never triggers this — it would mean sending the same
    // authenticated message for two different transactions. Vague to the
    // caller for the same reason as INVALID_SIGNATURE; loud in the log.
    message: 'Callback rejected',
  },
  CONFIRMATION_FAILED: {
    // 503, not 500: this is temporary and the provider should retry. A 5xx is
    // deliberate — most gateways retry on 5xx and stop on 4xx, and stopping is
    // the wrong outcome for a payment we could not confirm but may be real.
    status: 503,
    message: 'Could not confirm this payment with the provider',
  },
  PROVIDER_ERROR: { status: 502, message: 'The payment provider rejected the request' },
  PROVIDER_UNREACHABLE: { status: 504, message: 'The payment provider did not respond' },
});
