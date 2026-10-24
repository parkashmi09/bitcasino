'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('BANK_ACCOUNTS', {
  /** Same 404 for "not yours" as for "does not exist", so ids cannot be walked. */
  NOT_FOUND: {
    status: 404,
    message: 'No such saved account',
  },
  /** The same account number + IFSC, or the same UPI id, saved twice. */
  ALREADY_SAVED: {
    status: 409,
    message: 'That account is already saved',
  },
  /** A soft cap, so one account cannot fill the table. */
  TOO_MANY: {
    status: 422,
    message: 'You have reached the maximum number of saved accounts',
  },
});
