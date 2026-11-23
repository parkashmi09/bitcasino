'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler, noQuery } = require('@ibitplay/common');

const { LITERAL_EVENTS, encode, roomForUser } = require('@ibitplay/socket');

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
        // rainbet: the Settings privacy switches (migration 169).
        showBetsPublicly: z.boolean().optional(),
        showStatistics: z.boolean().optional(),
        tipNotifications: z.boolean().optional(),
        // Plain booleans: z.coerce would read the string "false" as true.
        hideGamingData: z.boolean().optional(),
        hideUsername: z.boolean().optional(),
        maxProfitAlert: z.boolean().optional(),
        depositEmail: z.boolean().optional(),
        withdrawEmail: z.boolean().optional(),
      })
      .strict(),
  };

  /** @legacy SOCKET identify */
  router.get(
    '/',
    noQuery(),
    asyncHandler(async (req, res) => response.ok(res, await service.get({ userId: req.user.id })))
  );

  router.patch(
    '/',
    validate(update),
    asyncHandler(async (req, res) => {
      const config = await service.update({ userId: req.user.id, ...req.body });
      // Every open tab of this player (the header's hide-balance, theme…) gets the new config at once. Both
      // rooms: every signed-in socket is in user:<id>, IDENTIFY also joins the legacy room:user:<id>.
      deps.io?.to([roomForUser(String(req.user.id)), `room:user:${req.user.id}`]).emit(LITERAL_EVENTS.USER_CONFIG_UPDATED, encode(config));
      return response.ok(res, config);
    })
  );

  return router;
};
