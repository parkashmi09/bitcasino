'use strict';

const errors = require('./xCasino.errors');
const { PROVIDER_ERROR } = require('./xCasino.constants');

/**
 * Our error codes, translated into the provider's.
 *
 * The provider's integration document defines these two-digit numbers and its
 * client branches on them, so they are an external contract — not something
 * this platform gets to choose. Kept here rather than in the error catalogue
 * because `defineErrors` is shared by every module and has no business knowing
 * about one aggregator's numbering.
 *
 * Anything unmapped becomes `90`, which is what the provider expects for a
 * condition it has no code for. Defaulting to a specific code instead would
 * tell the provider something definite and wrong — `75` would have it show the
 * player "insufficient balance" for a bug on our side.
 */
const PROVIDER_CODE_FOR = Object.freeze({
  [errors.BAD_SIGNATURE.code]: PROVIDER_ERROR.INVALID_HASH.code,
  [errors.STALE_REQUEST.code]: PROVIDER_ERROR.INVALID_HASH.code,
  [errors.INVALID_SESSION.code]: PROVIDER_ERROR.INVALID_SESSION.code,
  [errors.SESSION_EXPIRED.code]: PROVIDER_ERROR.INVALID_SESSION.code,
  [errors.PLAYER_NOT_FOUND.code]: PROVIDER_ERROR.USER_NOT_FOUND.code,
  [errors.PLAYER_LOCKED.code]: PROVIDER_ERROR.USER_NOT_FOUND.code,
  [errors.INSUFFICIENT_FUNDS.code]: PROVIDER_ERROR.INSUFFICIENT_FUNDS.code,
  [errors.UNSUPPORTED_COIN.code]: PROVIDER_ERROR.MISSING_FIELDS.code,
  [errors.CURRENCY_MISMATCH.code]: PROVIDER_ERROR.MISSING_FIELDS.code,
  [errors.UNKNOWN_TRANSACTION_TYPE.code]: PROVIDER_ERROR.MISSING_FIELDS.code,
  [errors.NEGATIVE_AMOUNT.code]: PROVIDER_ERROR.MISSING_FIELDS.code,
  [errors.DUPLICATE_TRANSACTION.code]: PROVIDER_ERROR.INTERNAL.code,
  [errors.TRANSACTION_NOT_FOUND.code]: PROVIDER_ERROR.INTERNAL.code,
  [errors.CANNOT_CANCEL.code]: PROVIDER_ERROR.INTERNAL.code,
  [errors.NOT_CONFIGURED.code]: PROVIDER_ERROR.INTERNAL.code,
});

const providerCodeFor = (code) => PROVIDER_CODE_FOR[code] ?? PROVIDER_ERROR.INTERNAL.code;

module.exports = { PROVIDER_CODE_FOR, providerCodeFor };
