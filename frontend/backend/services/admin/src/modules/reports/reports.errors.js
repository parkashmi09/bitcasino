'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('REPORTS', {
  /**
   * One code for "no such player" and "not your player".
   *
   * Deliberate. Two distinguishable answers turn the endpoint into an oracle
   * for which ids exist — which is exactly how an agent would map a rival's
   * downline. Legacy answered `403 'User is not in your hierarchy'` on the
   * routes that checked at all, which says the player exists.
   */
  PLAYER_NOT_FOUND: { status: 404, message: 'Player not found' },

  AGENT_NOT_FOUND: { status: 404, message: 'Agent not found' },

  BAD_RANGE: { status: 400, message: '`from` must not be after `to`' },

  RANGE_TOO_LARGE: {
    status: 400,
    // A statement over "all time" for a busy tree is a full-table scan on four
    // tables. Legacy allowed an unbounded range and an unbounded page size.
    message: 'That date range is longer than a report may cover',
  },

  UNSUPPORTED_CURRENCY: {
    status: 400,
    message: 'No balance sheet is kept in that currency',
  },

  EXPORT_TOO_LARGE: {
    status: 413,
    message: 'That export covers more rows than one file may carry — narrow the range or filter',
  },
});
