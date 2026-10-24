'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { validate, response, asyncHandler, wagerCategory } = require('@ibitplay/common');

const { WagerActivityService } = require('../wagerActivity.service');

/**
 * `POST /internal/user/wager/record` — count one stake toward `userwager`.
 *
 * Every settlement path posts here (casino in-house, js-games, GIS, sports).
 * The stake arrives in its own currency and is converted to USD here, so no
 * caller can count rupees as dollars. `(source, ref)` makes it exactly-once.
 */
const record = {
  body: z
    .object({
      userId: z.coerce.number().int().positive(),
      amount: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'amount must be a non-negative decimal'),
      currency: z.string().trim().min(2).max(10),
      source: z.string().trim().min(1).max(40),
      ref: z.string().trim().min(1).max(190),
      rakeback: z.boolean().optional(),
      // What kind of bet (migration 132) — optional; resolved from `source` / defaults when absent.
      category: z.enum(wagerCategory.CATEGORIES).optional(),
      provider: z.string().trim().max(120).optional(),
      gameRef: z.string().trim().max(190).optional(),
      odds: z.string().trim().regex(/^\d+(\.\d{1,4})?$/).optional(),
      houseEdge: z.string().trim().regex(/^0(\.\d{1,6})?$/).optional(),
    })
    .strict(),
};

/**
 * `POST /internal/user/wager/reverse` — a refunded / rolled-back stake stops
 * counting: its USD leaves `userwager`, its unclaimed rakeback leaves
 * `users.rakeamount`, its bonus wagering comes back out and the referrer's
 * unclaimed commission for it is voided. Idempotent per `(source, ref)`; a
 * reversal before its stake leaves a tombstone so the late bet is not counted.
 *
 * Optional partial refund (migration 090): `amount` (decimal string, the stake's
 * currency, > 0 — more than the stake is refused, more than what is left takes what
 * is left) pro-rates everything above; `refundRef` (the provider's refund id) makes
 * each partial refund its own idempotency key — the same `(ref, refundRef)` twice is
 * a duplicate. A partial `amount` without a `refundRef` is refused.
 */
const reverse = {
  body: z
    .object({
      userId: z.coerce.number().int().positive(),
      source: z.string().trim().min(1).max(40),
      ref: z.string().trim().min(1).max(190),
      amount: z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,8})?$/, 'amount must be a positive decimal')
        .refine((v) => /[1-9]/.test(v), 'amount must be greater than zero')
        .optional(),
      refundRef: z.string().trim().min(1).max(190).optional(),
    })
    .strict(),
};

module.exports = function internalRoutes(deps) {
  const service = new WagerActivityService(deps);
  const router = Router();

  router.post(
    '/record',
    validate(record),
    asyncHandler(async (req, res) => response.ok(res, await service.record(req.body)))
  );

  router.post(
    '/reverse',
    validate(reverse),
    asyncHandler(async (req, res) => response.ok(res, await service.reverse(req.body)))
  );

  return router;
};
