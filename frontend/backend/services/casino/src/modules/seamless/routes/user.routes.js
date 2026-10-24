'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { SeamlessCatalogueService } = require('../seamlessCatalogue.service');

/**
 * The operator side of the seamless integration: what games exist, and opening
 * one.
 *
 * `POST /launch-game` was unauthenticated in legacy with the player named in
 * the body — and it read `users.password` and posted the hash to the provider.
 * There is no member parameter here; the player comes from the token, and the
 * secret the provider receives is derived from OUR key.
 */
module.exports = function userRoutes(deps) {
  const service = new SeamlessCatalogueService(deps);
  const router = Router();

  /** @legacy GET /fetch-products */
  router.get(
    '/products',
    asyncHandler(async (_req, res) => response.ok(res, await service.products()))
  );

  /** @legacy GET /fetch-games — 500 on every call; `sign` was not defined */
  router.get(
    '/games',
    validate({
      query: z
        .object({
          providerName: z.string().trim().min(1).max(120),
          gameType: z.string().trim().min(1).max(60),
        })
        .strict(),
    }),
    asyncHandler(async (req, res) => response.ok(res, await service.games(req.query)))
  );

  /** @legacy POST /launch-game */
  router.post(
    '/launch',
    validate({
      body: z
        .object({
          productCode: z.string().trim().min(1).max(120),
          gameType: z.string().trim().min(1).max(60),
          gameCode: z.string().trim().max(190).optional(),
        })
        .strict(),
    }),
    asyncHandler(async (req, res) =>
      response.created(res, await service.launch({ ...req.body, userId: req.user.id, ip: req.ip }))
    )
  );

  return router;
};
