'use strict';

const { defineErrors } = require('@ibitplay/common');

module.exports = defineErrors('TIP', {
  USER_NOT_FOUND: { status: 404, message: 'No player with that username' },
  SELF: { status: 400, message: 'You cannot tip yourself' },
  DISABLED_BY_RECIPIENT: { status: 400, message: 'This player does not accept tips' },
  RECIPIENT_UNAVAILABLE: { status: 400, message: 'This player cannot receive tips' },
  SENDER_BLOCKED: { status: 403, message: 'Your account cannot send tips' },
  KYC_REQUIRED: { status: 403, message: 'Identity verification must be completed before sending tips' },
  INSUFFICIENT_BALANCE: { status: 400, message: 'Insufficient balance for this tip' },
  MIN_AMOUNT: { status: 400, message: 'The amount is below the minimum tip' },
  RATE_LIMITED: { status: 429, message: 'Too many tips — try again later' },
  // Operator limits (siteconfig, migration 081), all USD.
  /** details `{ maxUsd, maxInCurrency, currency }` */
  OVER_PER_TIP_LIMIT: { status: 400, message: 'This tip is above the largest tip allowed' },
  /** details `{ maxUsd, usedUsd, remainingInCurrency, currency }` */
  OVER_DAILY_LIMIT: { status: 400, message: 'This tip would go over your daily tip limit' },
  /** details `{ requiredUsd, wageredUsd }` */
  WAGER_REQUIRED: { status: 403, message: 'You need to wager more before you can send tips' },
  /** details `{ currency }` — no exchange rate, so the USD limits cannot be checked. */
  NO_RATE: { status: 400, message: 'Tips in this currency are not available right now' },
});
