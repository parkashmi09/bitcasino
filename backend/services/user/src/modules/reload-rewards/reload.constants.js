'use strict';

const PROGRAM = Object.freeze({ DAILY_RELOAD: 'DAILY_RELOAD', PRE_MONTHLY: 'PRE_MONTHLY' });

/** Pre-Monthly measures the 1st–14th and is claimable from the 15th (UTC). */
const PRE_MONTHLY_OPENS_DAY = 15;

/** The ledger reason a reload is credited under. */
const REASON = Object.freeze({ RELOAD: 'reload_bonus' });

module.exports = { PROGRAM, PRE_MONTHLY_OPENS_DAY, REASON };
