'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { WagerReportService } = require('../wagerReport.service');

/**
 * Casino turnover, for the services that need it to decide whether a reward
 * has been earned.
 *
 * Internal only — behind the shared internal key, and the gateway refuses to
 * proxy `/internal/*` from outside. A player must not be able to ask this
 * directly: knowing another player's exact turnover is both a privacy leak and,
 * for anyone probing a bonus condition, useful reconnaissance.
 */
const params = {
  params: z.object({ userId: z.coerce.number().int().positive() }),
  query: z.object({
    from: z.string().trim().min(8).max(35).optional(),
    to: z.string().trim().min(8).max(35).optional(),
  }),
};

module.exports = function internalRoutes(deps) {
  const service = new WagerReportService(deps);
  const router = Router();

  router.get(
    '/turnover/:userId',
    validate(params),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.turnover({ userId: req.params.userId, ...req.query }))
    )
  );

  return router;
};
