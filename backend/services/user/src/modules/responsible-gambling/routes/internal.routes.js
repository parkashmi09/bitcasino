'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { ResponsibleService } = require('../responsible.service');

/**
 * The stake check for services that take a stake without the wallet's `debit` — the casino
 * in-house engine debits `credits` itself. 200 `{ allowed: true }`, or the same 403
 * RESPONSIBLE_* refusal the wallet would give.
 */
const check = {
  body: z
    .object({
      userId: z.coerce.string().regex(/^\d+$/),
      currency: z.string().trim().min(2).max(20),
      amount: z.coerce.string(),
      sports: z.boolean().default(false),
    })
    .strict(),
};

module.exports = function internalRoutes(deps) {
  const service = new ResponsibleService(deps);
  const router = Router();
  router.post(
    '/check',
    validate(check),
    asyncHandler(async (req, res) => {
      await service.assertMayStake(req.body);
      return response.ok(res, { allowed: true });
    })
  );
  return router;
};
