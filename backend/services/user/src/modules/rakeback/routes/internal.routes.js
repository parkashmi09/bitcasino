'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const { RakebackService } = require('../rakeback.service');

/**
 * Rakeback accrual, for the services that settle wagers.
 *
 * Mounted at `/internal/user/rakeback`, behind `internalAuth` and the ACL in
 * `internalAcl.js`. casino-service holds it; nothing else does.
 *
 * ── WHY THE AMOUNT COMES FROM THE CALLER ─────────────────────────────────
 *
 * Because only the caller knows it. The figure is a rate applied to a stake, in
 * a currency the settling service chose, on a round this service has never
 * heard of. Recomputing it here would mean user-service holding a copy of every
 * integration's rate table and stake history.
 *
 * What this service keeps is the part that is ITS business: the column, the row
 * lock, and the guarantee that one `(source, ref)` accrues once. The caller is
 * already trusted — it can mint balance through `/internal/user/wallet/credit`,
 * which is a far shorter path to the same place than inflating a rakeback
 * accrual the player still has to claim.
 */
const accrue = {
  body: z
    .object({
      userId: z.coerce.number().int().positive(),
      /**
       * Pre-computed accrual (legacy/compat). Prefer `stakeUsd` so this
       * service can apply the player's VIP rakeback rate.
       */
      amount: z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,8})?$/, 'amount must be a positive decimal')
        .optional(),
      /** USD face value of the stake — rate is applied here from `users.rakeback`. */
      stakeUsd: z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,8})?$/, 'stakeUsd must be a positive decimal')
        .optional(),
      /** The integration accruing it. Bounded because it is written to a column. */
      source: z.string().trim().min(1).max(40),
      /** That integration's idempotency key — a round id, a bet id. */
      ref: z.string().trim().min(1).max(190),
    })
    .strict()
    .refine((body) => Boolean(body.amount || body.stakeUsd), {
      message: 'amount or stakeUsd is required',
    }),
};

module.exports = function internalRoutes(deps) {
  const service = new RakebackService(deps);
  const router = Router();

  router.post(
    '/accrue',
    validate(accrue),
    asyncHandler(async (req, res) => response.ok(res, await service.accrue(req.body)))
  );

  return router;
};
