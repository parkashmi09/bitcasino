'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { PreferencesService } = require('../preferences.service');
const { THEMES, LANGUAGES } = require('../preferences.constants');

/**
 * A player's own settings, over HTTP.
 *
 * Legacy had no HTTP route for these at all — `userconfig` was reachable only
 * through the two socket events, and both took the player id from the message.
 * The id comes from the token here, on both transports.
 */
module.exports = function userRoutes(deps) {
  const service = new PreferencesService(deps);
  const router = Router();

  const update = {
    body: z
      .object({
        theme: z.enum(THEMES).optional(),
        language: z.enum(LANGUAGES).optional(),
        emailNotifications: z.coerce.boolean().optional(),
        pushNotifications: z.coerce.boolean().optional(),
        hideBalance: z.coerce.boolean().optional(),
      })
      .strict(),
  };

  /** @legacy SOCKET identify */
  router.get(
    '/',
    asyncHandler(async (req, res) => response.ok(res, await service.get({ userId: req.user.id })))
  );

  router.patch(
    '/',
    validate(update),
    asyncHandler(async (req, res) => response.ok(res, await service.update({ userId: req.user.id, ...req.body })))
  );

  return router;
};
