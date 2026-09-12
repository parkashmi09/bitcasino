'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('DASHBOARD', {
  PLAYER_NOT_FOUND: { status: 404, message: 'Player not found' },

  NO_EXCHANGE_RATES: {
    status: 503,
    /**
     * An empty `exchangerate` table means every USD figure on the dashboard
     * would be zero. Legacy's INNER JOIN produced exactly that — a dashboard
     * reporting no deposits ever, indistinguishable from a platform with no
     * deposits. Better to say the conversion is unavailable.
     */
    message: 'Exchange rates are unavailable, so USD totals cannot be computed',
  },
});
