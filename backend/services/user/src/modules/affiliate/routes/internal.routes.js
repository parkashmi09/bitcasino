'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const { AffiliateService } = require('../affiliate.service');

const wagerDecimal = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'wager must be a non-negative decimal');

const onWager = {
  body: z
    .object({
      userId: z.coerce.number().int().positive(),
      previousWager: wagerDecimal,
      newWager: wagerDecimal,
    })
    .strict(),
};

/**
 * Affiliate side-effects for wager settlement — tier unlocks and commission rows.
 *
 * casino-service posts after every `userwager` update, alongside VIP on-wager.
 */
module.exports = function internalRoutes(deps) {
  const service = new AffiliateService(deps);
  const router = Router();

  router.post(
    '/on-wager',
    validate(onWager),
    asyncHandler(async (req, res) => response.ok(res, await service.onWager(req.body)))
  );

  return router;
};
