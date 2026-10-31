'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler, refuseCustomCurrencies } = require('@ibitplay/common');

const { buildOriginalGamesService } = require('../originalGames.factory');
const { SUPPORTED_CURRENCIES, DEVICES } = require('../originalGames.constants');
const { requireGameEntitled } = require('../../games/gameEntitlement');

/** Opening an original. The player comes from the token; the launch is signed server-side only. */
module.exports = function userRoutes(deps) {
  const service = buildOriginalGamesService(deps);
  const router = Router();
  router.use(refuseCustomCurrencies('GAMES'));

  router.post(
    '/launch',
    validate({
      body: z
        .object({
          gameCode: z.string().trim().min(1).max(64),
          currencyCode: z.enum(SUPPORTED_CURRENCIES),
          device: z.enum(DEVICES).default('desktop'),
          language: z.string().trim().max(10).optional(),
        })
        .strict(),
    }),
    // casino + Originals + the game's category, as the in-house engine checks.
    requireGameEntitled(deps, (req) => ({ provider: 'in-house', type: req.body.gameCode })),
    asyncHandler(async (req, res) =>
      response.created(
        res,
        await service.launch({
          userId: req.user.id,
          gameCode: req.body.gameCode,
          currency: req.body.currencyCode,
          device: req.body.device,
          language: req.body.language,
        })
      )
    )
  );

  return router;
};
