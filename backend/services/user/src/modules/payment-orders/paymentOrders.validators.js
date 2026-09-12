'use strict';

const { z } = require('@ibitplay/common');

const { currency } = require('../exchange-rate/exchangeRate.validators');
const { moneyAmount } = require('../wallet/wallet.validators');

/**
 * What a caller may send.
 *
 * Note what is ABSENT from every schema here: any way to name a user. The
 * legacy endpoints took `userId` / `custom_user_id` from the body, which is how
 * an unauthenticated caller could deposit or withdraw on someone else's behalf.
 * These schemas are `.strict()`, so a request carrying such a field is rejected
 * rather than quietly ignored — an ignored field looks like it worked.
 *
 * `notify_url` is absent for the same reason: legacy let the caller choose
 * where the provider reported the result.
 */

const provider = z.enum(['waypay', 'apay', 'cricpay', 'upi', 'ccpayment']);

/** Provider payment-system identifiers: lowercase, underscores. */
const method = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/i, 'is not a valid payment method');

/**
 * A url we will send the player to after paying.
 *
 * Restricted to http(s) so a `javascript:` return url cannot be reflected back
 * into a page, and length-capped so it cannot be used to smuggle a payload
 * through the provider.
 */
const redirectUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) url');

const createDeposit = {
  body: z
    .object({
      provider,
      currency,
      amount: moneyAmount,
      method: method.optional(),
      returnUrl: redirectUrl.optional(),
      // Some rails require a contact for the payment page itself.
      phone: z.string().trim().regex(/^[0-9+\- ]{6,20}$/).optional(),
      userName: z.string().trim().min(1).max(60).optional(),
      /**
       * Which blockchain to issue the deposit address on. CCPayment only.
       *
       * Legacy passed both `chain` and `coinId` straight from the body to the
       * provider with no check, so an unknown pair produced a provider error
       * where a 422 belongs. There is deliberately NO `orderId` here — legacy
       * let the caller choose it, and it is the key the confirmation callback
       * resolves a payment against.
       */
      chain: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_]+$/).optional(),
    })
    .strict()
    .refine((v) => v.provider !== 'ccpayment' || v.chain !== undefined, {
      message: 'chain is required for a crypto deposit address',
      path: ['chain'],
    }),
};

const createWithdrawal = {
  body: z
    .object({
      provider,
      currency,
      amount: moneyAmount,
      method: method.optional(),
      /**
       * The payout destination. Shape depends on the payment system, so it is
       * checked by `payoutDetails.js` against that system's schema — before any
       * balance is held. Passthrough here, strict there.
       */
      details: z.record(z.string(), z.union([z.string(), z.number()])),
    })
    .strict(),
};

const orderParams = {
  params: z.object({ provider, reference: z.string().trim().min(1).max(255) }),
};

const listOrders = {
  query: z.object({
    flow: z.enum(['payin', 'payout']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

const providerParam = { params: z.object({ provider }) };

const repairUtr = {
  body: z
    .object({
      reference: z.string().trim().min(1).max(255),
      // A bank UTR is 12-22 alphanumerics depending on the rail.
      utr: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9]+$/),
    })
    .strict(),
};

module.exports = { createDeposit, createWithdrawal, orderParams, listOrders, providerParam, repairUtr };
