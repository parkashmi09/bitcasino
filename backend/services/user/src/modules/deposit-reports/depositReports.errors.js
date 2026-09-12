'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('DEPREPORT', {
  NOT_IN_SCOPE: {
    status: 404,
    /**
     * 404 rather than 403 — confirming an account exists but is outside the
     * caller's tree is itself information about the hierarchy.
     *
     * Legacy's P&L endpoints took the id from the request body on routes with
     * no authentication at all, so any id returned that account's position.
     */
    message: 'Account not found',
  },

  VISIBILITY_UNAVAILABLE: {
    status: 503,
    /**
     * Deliberately a hard failure rather than a fallback.
     *
     * This error means admin-service could not tell us which staff accounts the
     * caller may see. The tempting fallback — show everything, or show nothing —
     * is wrong in both directions: the first leaks every player's deposits
     * across the agent hierarchy, the second silently reports zero and looks
     * like a quiet day rather than an outage.
     */
    message: 'Cannot determine your reporting scope right now',
  },

  RATE_UNAVAILABLE: {
    status: 503,
    // Legacy fell back to a hard-coded ~₹83/USD when the exchange rate row was
    // missing, so a stale or absent rate silently changed every reported total
    // with nothing to indicate it.
    message: 'No exchange rate is available to convert these figures',
  },

  INVALID_DATE_RANGE: { status: 422, message: 'The end date is before the start date' },
});
