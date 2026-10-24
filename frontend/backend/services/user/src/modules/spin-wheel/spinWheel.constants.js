'use strict';

/** Which feature issued a redeem code. `redeembonus` is shared with the bonus engine. */
const CODE_SOURCE = 'spinwheel';

const CODE_STATUS = Object.freeze({
  ACTIVE: 'active',
  USED: 'used',
  EXPIRED: 'expired',
  /** Set by migration 013 on duplicates the legacy generator's race created. */
  SUPERSEDED: 'superseded',
});

/**
 * Eight characters, as legacy generated.
 *
 * Kept because codes already in players' hands are this length and the screens
 * that display them are laid out for it. Sixteen hex characters would be
 * better, and is worth doing when there is a reason to reissue.
 */
const CODE_LENGTH = 8;

/**
 * Where a qualifying deposit can have come from.
 *
 * Wider than the gift-card list on purpose: this one includes `fiat_deposits`,
 * matching the legacy spin-wheel query, which counted operator-approved manual
 * deposits. The gift-card check did not. Neither is obviously right, and the
 * difference is preserved rather than harmonised on a guess — but it is worth
 * a product decision.
 */
const DEPOSIT_SOURCES = Object.freeze([
  { provider: 'crypto', model: 'Ccdeposit', userColumn: 'userid', userIdIsText: true, successValues: ['Success', 'success', 'Completed', 'completed'] },
  { provider: 'apay', model: 'Apaydeposits', userColumn: 'user_id', userIdIsText: false, successValues: ['Success', 'success', 'Completed', 'completed'] },
  { provider: 'waypay', model: 'PayInTransactions', userColumn: 'user_id', userIdIsText: false, successValues: [1] },
  { provider: 'manual', model: 'FiatDeposits', userColumn: 'user_id', userIdIsText: false, successValues: ['approved', 'Approved'] },
]);

module.exports = { CODE_SOURCE, CODE_STATUS, CODE_LENGTH, DEPOSIT_SOURCES };
