'use strict';

const { defineErrors } = require('@ibitplay/common');

/** Launch-side errors. The wallet callbacks never throw — they answer in the aggregator's envelope. */
module.exports = defineErrors('ORIGINAL_GAMES', {
  DISABLED: { status: 403, message: 'Originals are switched off on this site' },
  GAME_DISABLED: { status: 403, message: 'This game is switched off on this site' },
  GAME_NOT_FOUND: { status: 404, message: 'No such Original game' },
  NOT_CONFIGURED: { status: 503, message: 'The original games aggregator is not configured' },
  UNSUPPORTED_CURRENCY: { status: 422, message: 'Original games play in INR or USDT only' },
  ORIGINALS_LOCKED: { status: 403, message: 'Original Games are locked on this account' },
  UPSTREAM_FAILED: { status: 502, message: 'The game provider could not be reached' },
  UPSTREAM_REJECTED: { status: 502, message: 'The game provider rejected the request' },
  MAINTENANCE: { status: 503, message: 'The game is under maintenance' },
});
