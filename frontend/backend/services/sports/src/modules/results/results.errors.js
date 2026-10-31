'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('RESULTS', {
  VISIBILITY_UNAVAILABLE: {
    status: 503,
    message: 'Could not determine which accounts you may report on',
  },
  NOT_IN_YOUR_TREE: { status: 404, message: 'Player not found' },
});
