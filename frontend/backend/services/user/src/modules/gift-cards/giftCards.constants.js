'use strict';

/**
 * Where a player stands on a gift card.
 *
 * Capitalised because that is what is in the column today — `user_gift_cards.
 * status` holds 'Activated' and 'Claimed', written by the legacy code. Changing
 * the casing would need a data migration and would make every row written by
 * the legacy process during a cutover invisible to this one.
 *
 * `AVAILABLE` has no row: a card the player has not taken yet simply has no
 * `user_gift_cards` entry. It is here so the read paths have a word for that
 * state instead of returning null and making the client invent one.
 */
const STATUS = Object.freeze({
  AVAILABLE: 'Available',
  ACTIVATED: 'Activated',
  CLAIMED: 'Claimed',
  EXPIRED: 'Expired',
});

/**
 * Where a qualifying deposit can have come from.
 *
 * Ordered as the legacy check ordered them, which matters: the check stops at
 * the first transaction that clears the bar, so the order decides which
 * transaction id is reported back. Not a correctness issue, but a support
 * answer that changes for no reason is its own kind of bug.
 *
 * `manual` (fiat_deposits) is deliberately ABSENT, matching legacy — an
 * operator-approved deposit does not qualify a player for a gift card. Whether
 * that is intended policy or an oversight is worth asking; it is preserved
 * here rather than silently widened.
 */
const DEPOSIT_SOURCES = Object.freeze([
  {
    provider: 'waypay',
    model: 'PayInTransactions',
    idColumn: 'id',
    userColumn: 'user_id',
    userIdIsText: false,
    successValues: [1],
  },
  {
    provider: 'apay',
    model: 'Apaydeposits',
    idColumn: 'id',
    userColumn: 'user_id',
    userIdIsText: false,
    successValues: ['Success'],
  },
  {
    provider: 'crypto',
    model: 'Ccdeposit',
    idColumn: 'id',
    userColumn: 'userid',
    // VARCHAR — see paymentOrders.constants for the full list of these.
    userIdIsText: true,
    successValues: ['Success'],
    // USDT ≈ USD, and this table has no currency column.
    currency: 'USDT',
  },
]);

module.exports = { STATUS, DEPOSIT_SOURCES };
