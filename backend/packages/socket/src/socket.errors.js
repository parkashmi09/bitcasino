'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('SOCKET', {
  BAD_FRAME: {
    status: 400,
    /**
     * Legacy caught the `JSON.parse` throw, logged it to stdout and returned
     * `undefined` — so the caller destructured `undefined` and threw somewhere
     * unrelated, or read a missing field as absent and carried on.
     */
    message: 'That frame could not be decoded',
  },

  FRAME_TOO_LARGE: {
    status: 413,
    // Legacy had no limit, on a socket anyone could open.
    message: 'That frame is larger than a socket message may be',
  },

  UNAUTHENTICATED: {
    status: 401,
    /**
     * Every legacy handler wrote `if (!id) return;` — a silent drop. The client
     * waits for a reply that never comes and shows a spinner. An explicit
     * error frame is answerable.
     */
    message: 'That action needs a signed-in session',
  },

  SESSION_EXPIRED: { status: 401, message: 'Your session has expired' },

  RATE_LIMITED: {
    status: 429,
    /**
     * Legacy had no rate limiting on any socket event, including login — so
     * password guessing over the socket was unmetered, and so was tipping.
     */
    message: 'Too many messages — slow down',
  },

  UNKNOWN_EVENT: { status: 404, message: 'Unknown event' },

  HANDLER_FAILED: {
    status: 500,
    // What a client is told. The stack goes to our logs.
    message: 'That action could not be completed',
  },
});
