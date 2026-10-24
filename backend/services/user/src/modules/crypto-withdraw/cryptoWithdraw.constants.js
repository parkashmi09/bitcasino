'use strict';

/**
 * Crypto withdrawal states.
 *
 * `In Queue` is written with a space and that casing by
 * `legacy/Users/Rule.js`, which is what creates these rows. Kept verbatim:
 * existing rows carry it and the admin screens match the exact string.
 *
 * The rest of the vocabulary is new. Legacy had none — `status` was whatever
 * string the request body contained — so these are the values the queue is
 * allowed to move to, and anything else is a 422 rather than a silent write.
 */
const STATUS = Object.freeze({
  IN_QUEUE: 'In Queue',
  APPROVED: 'Approved',
  SENT: 'Sent',
  REJECTED: 'Rejected',
});

const STATUSES = Object.freeze(Object.values(STATUS));

/**
 * Which moves are legal from where.
 *
 * A withdrawal that has been sent on-chain cannot be un-sent, so `Sent` and
 * `Rejected` are terminal. Legacy had no transitions at all: a settled
 * withdrawal could be set back to pending and approved a second time, and since
 * approval is what tells an operator to send coin, that is a second payout.
 */
const TRANSITIONS = Object.freeze({
  [STATUS.IN_QUEUE]: [STATUS.APPROVED, STATUS.REJECTED],
  // Approved but not yet broadcast — still recallable.
  [STATUS.APPROVED]: [STATUS.SENT, STATUS.REJECTED],
  [STATUS.SENT]: [],
  [STATUS.REJECTED]: [],
});

/**
 * Statuses that return the held funds.
 *
 * Only rejection. `Sent` means the coin has left, and `Approved` means it is
 * about to — neither gives the money back.
 */
const REFUNDING_STATUSES = Object.freeze([STATUS.REJECTED]);

/** The wallet column a coin lives on. A map, never a string in the SQL. */
const COIN_COLUMNS = Object.freeze({
  BTC: 'btc', ETH: 'eth', LTC: 'ltc', BCH: 'bch', USDT: 'usdt', TRX: 'trx',
  DOGE: 'doge', ADA: 'ada', XRP: 'xrp', BNB: 'bnb', USDC: 'usdc', BUSD: 'busd',
  SHIB: 'shib', MATIC: 'matic', INR: 'inr',
});

/** `nc` is play money — legacy refuses it here too. */
const BLOCKED_COINS = Object.freeze(['NC']);

/**
 * A coin as the ledger spells it: upper-case.
 *
 * `credits_ledger.currency` is compared exactly by `WalletService.reconcile`,
 * so a refund written under `'usdt'` is invisible to `reconcile('USDT')`. Rows
 * the old socket path wrote carry the lower-case spelling, so every read of
 * `withdrawals.coin` that moves money goes through this.
 */
const normaliseCoin = (coin) => String(coin ?? '').trim().toUpperCase();

module.exports = { STATUS, STATUSES, TRANSITIONS, REFUNDING_STATUSES, COIN_COLUMNS, BLOCKED_COINS, normaliseCoin };
