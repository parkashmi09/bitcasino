'use strict';

const { defineErrors } = require('@ibitplay/common');
const { MAX_RANGE_DAYS } = require('./statements.constants');

module.exports = defineErrors('STATEMENTS', {
  /**
   * One code for "no such subject" and "not in your tree".
   *
   * Legacy answered `403 'Agent is not in your hierarchy'`, which confirms the
   * agent exists — enough to enumerate a rival's downline by walking ids and
   * reading which come back 403 rather than 404.
   */
  SUBJECT_NOT_FOUND: { status: 404, message: 'No such account' },

  BAD_RANGE: { status: 400, message: '`from` must not be after `to`' },

  RANGE_REQUIRED: {
    status: 400,
    /**
     * An agent statement fans out over the whole downline. Legacy accepted no
     * dates as "all time" and read every movement the tree had ever made into
     * one array to sort it.
     */
    message: 'An agent statement needs a date range',
  },

  RANGE_TOO_LARGE: {
    status: 400,
    message: `A statement may cover at most ${MAX_RANGE_DAYS} days`,
  },
});
