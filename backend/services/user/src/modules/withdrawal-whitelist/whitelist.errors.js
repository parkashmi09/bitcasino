'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('WHITELIST', {
  /**
   * Same 404 for "not yours" as for "does not exist", so ids cannot be walked
   * to learn which are real — the pattern the favourites and bet-detail routes
   * already use.
   */
  ADDRESS_NOT_FOUND: {
    status: 404,
    message: 'No such address',
  },

  /**
   * Adding an address that is already saved for that currency.
   *
   * 409 rather than a silent upsert: unlike a favourite, an address is a thing
   * the player TYPED, and quietly folding a second attempt into the first
   * would hide a mistake — two labels for one address, or a typo the player
   * believes they saved. The unique index is the guarantee; this is the shape
   * it surfaces as.
   */
  ALREADY_WHITELISTED: {
    status: 409,
    message: 'That address is already on your whitelist',
  },

  /**
   * Turning the switch on with nothing on the list.
   *
   * THIS IS THE ONE WAY THIS FEATURE COULD LOCK SOMEBODY OUT OF THEIR OWN
   * MONEY: whitelist-only enforcement plus an empty whitelist means no
   * withdrawal can ever be made, and the pane that fixes it is the same one
   * that broke it. Refused rather than allowed-and-warned.
   */
  EMPTY_WHITELIST: {
    status: 422,
    message: 'Add an address before turning whitelist-only withdrawals on',
  },

  /** A soft cap, so one account cannot fill the table. */
  TOO_MANY_ADDRESSES: {
    status: 422,
    message: 'You have reached the maximum number of saved addresses',
  },
});
