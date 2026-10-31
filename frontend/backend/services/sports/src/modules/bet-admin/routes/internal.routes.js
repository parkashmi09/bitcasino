'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { BetAdminService } = require('../betAdmin.service');

/**
 * Net sports exposure, for admin-service.
 *
 * The operator console shows this beside the rest of an account's position, and
 * `user_exposures` belongs to sports-service. Reimplementing the arithmetic on
 * the other side would be a second chance to get the sign wrong — summing a
 * player's winning outcomes with their losing ones reports a net near zero for
 * a fully hedged book, which is what legacy's version did.
 *
 * The caller has already resolved its own staff subtree, so the ids come in
 * rather than being resolved again here.
 */
module.exports = function internalRoutes(deps) {
  const service = new BetAdminService(deps);
  const router = Router();

  router.get(
    '/net',
    validate({
      query: z.object({
        staffId: z.coerce.number().int().positive(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.netExposure({ staff: { id: req.query.staffId }, ...req.query }))
    )
  );

  return router;
};
