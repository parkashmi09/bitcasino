'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * Legacy had one error shape for everything:
 *
 *     const fail = (r, s, m) => r.status(s).json({ name: 'Error', message: m, code: 0, status: s });
 *
 * — `code: 0` on every failure, so a client could not distinguish "that book
 * does not exist" from "the provider is down" without reading English.
 */
module.exports = defineErrors('SPORTSBOOK', {
  NOT_CONFIGURED: {
    status: 503,
    // Same reasoning as GIS: signing with an undefined key produces a stable,
    // guessable signature. Refusing is the safer failure.
    message: 'The sportsbook integration is not configured',
  },

  UPSTREAM_FAILED: { status: 502, message: 'The sportsbook provider could not be reached' },
  UPSTREAM_REJECTED: { status: 502, message: 'The sportsbook provider rejected the request' },

  SESSION_NOT_FOUND: { status: 404, message: 'Sportsbook session not found' },
  SESSION_CLOSED: { status: 409, message: 'That sportsbook session has been closed' },
  SESSION_ALREADY_OPEN: {
    status: 409,
    // The unique partial index in migration 031 is the real guard; this is the
    // readable version of hitting it.
    message: 'A session is already open on that sportsbook',
  },

  UNSUPPORTED_CURRENCY: { status: 422, message: 'That currency is not supported for sportsbook play' },
  SPORTSBOOK_LOCKED: { status: 403, message: 'Sportsbook play is locked on this account' },
  USER_NOT_FOUND: { status: 404, message: 'Player not found' },
});
