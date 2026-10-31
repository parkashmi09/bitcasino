'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('MEDALS', {
  USER_NOT_FOUND: {
    status: 404,
    message: 'Account not found',
  },
});
