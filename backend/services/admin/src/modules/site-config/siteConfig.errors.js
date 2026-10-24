'use strict';

const { defineErrors, entitlements } = require('@ibitplay/common');

module.exports = Object.freeze({
  /** A flag the owner has not put in the site's plan — details `{ kind: 'flag', key }`. */
  NOT_ENTITLED: entitlements.entitlementErrors.ENTITLED,
  ...defineErrors('SITE_CONFIG', {
  NOT_CONFIGURED: {
    status: 409,
    /**
     * Legacy's UPDATE had no WHERE clause, so against an empty `siteconfig` it
     * matched zero rows, read `rows[0]` of nothing, and answered
     * "Settings updated successfully" with `data: undefined`. A write that
     * changed nothing reported success.
     */
    message: 'There is no site configuration row to update',
  },

  /**
   * A body named a reward payout coin other than the site's reward currency.
   * Every reward pays in that ONE coin (owner-set); details
   * `{ field, rewardCurrency }`. Wire code `SITE_CONFIG_REWARD_CURRENCY_FIXED`.
   */
  REWARD_CURRENCY_FIXED: {
    status: 409,
    message: "Rewards are paid in the site's reward currency, which cannot be changed here",
  },

  NO_ALERT_INBOX: {
    status: 422,
    message: 'Set a notification email address before sending a test',
  },

  /** Payment Methods: a currency the gateway takes no methods in (details `{ gateway, currency }`). */
  PAYMENT_CURRENCY_NOT_TAKEN: { status: 422, message: 'This gateway takes no methods in that currency' },
  /** Payment Methods: no such method on that gateway. */
  PAYMENT_METHOD_NOT_FOUND: { status: 404, message: 'No such payment method' },

  /**
   * The body named nothing this endpoint is willing to write.
   *
   * Distinct from "nothing to change": the caller may well have sent fields,
   * and every one of them was outside the allow-list. Saying so is the point —
   * legacy would have written them.
   */
  NOTHING_TO_UPDATE: {
    status: 400,
    message: 'Give at least one setting this endpoint can change',
  },

  PLAYER_NOT_IN_YOUR_TREE: {
    status: 403,
    message: 'That player is not in your tree',
  },

  /**
   * `settings` is a set of decisions the code names, not a bag. A key nobody
   * declared would be written, read by nothing, and quietly mean nothing.
   */
  UNKNOWN_SETTING: {
    status: 422,
    message: 'That is not a setting this site keeps',
  },

  /**
   * The setting's column is not in the database yet — the server has the new
   * code and has not run the migration. Details `{ migration }`.
   */
  MIGRATION_PENDING: {
    status: 503,
    message: 'This setting needs a database migration that has not been run yet',
  },

  /** A limit outside what it may be — below its floor, or under its own minimum. */
  INVALID_SETTING: {
    status: 422,
    message: 'That value is not allowed for this setting',
  },
}),
});
