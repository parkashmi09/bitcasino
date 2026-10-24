'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * A race's refusals.
 *
 * `NOT_RUNNING` and `NO_ACTIVE_RACE` are deliberately different. The first is
 * an operator decision — the promotion is switched off, and a client should
 * hide the surface entirely. The second is a race that should exist and does
 * not, which means the worker that rolls the windows is not running. The
 * reference answered both with the same 404, so three days of a stalled cron
 * looked exactly like a disabled feature.
 */
module.exports = defineErrors('RACE', {
  NOT_CONFIGURED: { status: 404, message: 'That race has not been set up' },
  NOT_RUNNING: { status: 404, message: 'That race is not currently running' },

  NO_ACTIVE_RACE: {
    status: 503,
    /**
     * 503, not 404: the race is enabled and configured, so this is the platform
     * failing to open a window rather than the player asking for something that
     * does not exist. A 503 also tells a client to retry, which a 404 does not.
     */
    message: 'No race window is open right now — please try again shortly',
  },

  REWARD_NOT_FOUND: { status: 404, message: 'That race reward does not exist' },
  ALREADY_CLAIMED: {
    status: 409,
    // The conditional UPDATE is the real defence; this is what losing that race
    // reads like to a client that double-clicked.
    message: 'That race reward has already been claimed',
  },

  INVALID_CONFIG: { status: 422, message: 'That race configuration is not valid' },

  /** Settle or cancel on a race that has already been settled or cancelled. */
  NOT_OPEN: { status: 409, message: 'That race is no longer open' },

  /** Test race: one OPEN race per type, so staff settle or cancel the running one first. */
  ALREADY_OPEN: { status: 409, message: 'A race of that type is already open — settle or cancel it first' },
  INVALID_WINDOW: { status: 422, message: 'That race window is not valid' },
});
