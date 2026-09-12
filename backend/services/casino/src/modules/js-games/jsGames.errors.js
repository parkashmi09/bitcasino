'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * Operator- and player-facing errors.
 *
 * The two provider callbacks do NOT use these: both providers expect their own
 * `{code, msg}` envelope with HTTP 200, and a shape they cannot parse is
 * something they retry. See `jsGames.service.js`.
 */
module.exports = defineErrors('JSGAMES', {
  NOT_CONFIGURED: { status: 503, message: 'This game provider is not configured' },
  UPSTREAM_FAILED: { status: 502, message: 'The game provider could not be reached' },
  UPSTREAM_REJECTED: { status: 502, message: 'The game provider rejected the request' },

  GAME_NOT_FOUND: { status: 404, message: 'Game not found or not active' },
  UNSUPPORTED_CURRENCY: { status: 422, message: 'That currency is not supported for this provider' },
  CASINO_LOCKED: { status: 403, message: 'Casino play is locked on this account' },

  TRANSFER_AMOUNT_REQUIRED: { status: 422, message: 'A positive transfer amount is required' },

  TRANSFER_NOT_PERMITTED: {
    status: 403,
    /**
     * `POST /jsGames/game/transfer` credited the PROVIDER's wallet for any named
     * user with no authentication and no matching debit on our side — free money
     * at the provider's expense, or ours, depending on how the account settles.
     * It is staff-only here, and it debits before it credits.
     */
    message: 'Provider wallet transfers are an operator action',
  },
});
