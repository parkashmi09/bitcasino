'use strict';

const { defineErrors } = require('@ibitplay/common');

/**
 * These surface on the OPERATOR-facing routes — launch, freespins, sync.
 *
 * The provider callback does not use them: Slotegrator requires HTTP 200 with
 * `{error_code, error_description}` on every response including refusals, so
 * that path returns a shaped object rather than throwing. See `gis.service.js`.
 */
module.exports = defineErrors('GIS', {
  NOT_CONFIGURED: {
    status: 503,
    // Falling through to a signature computed against `undefined` would produce
    // a stable, guessable signature — worse than refusing.
    message: 'The Slotegrator integration is not configured',
  },

  UPSTREAM_FAILED: { status: 502, message: 'The game provider could not be reached' },
  UPSTREAM_REJECTED: { status: 502, message: 'The game provider rejected the request' },

  UNSUPPORTED_CURRENCY: { status: 422, message: 'That currency is not supported for casino play' },
  GAME_NOT_FOUND: { status: 404, message: 'Game not found' },
  USER_NOT_FOUND: { status: 404, message: 'Player not found' },

  CASINO_LOCKED: {
    status: 403,
    message: 'Casino play is locked on this account',
  },

  FREESPIN_NOT_FOUND: { status: 404, message: 'Freespin campaign not found' },
  FREESPIN_EXISTS: { status: 409, message: 'A freespin campaign with this id already exists' },
  FREESPIN_BET_REQUIRED: {
    status: 422,
    message: 'Provide either bet_id with denomination, or total_bet_id',
  },

  VOUCHER_NOT_FOUND: { status: 404, message: 'Voucher not found' },
  VOUCHER_EXISTS: { status: 409, message: 'A voucher with this id already exists' },

  SYNC_IN_PROGRESS: {
    status: 409,
    // Two syncs writing the same rows is how the catalogue ends up half from
    // one page set and half from another.
    message: 'A catalogue sync is already running',
  },
});
