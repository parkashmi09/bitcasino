'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { createTeamLogos } = require('../teamLogos.service');

/**
 * Mounted at `/api/v1/sports/team-logos` (public — logos are public images).
 *
 *  GET /?name=India     → { name, logo, matched }   logo is a URL, or null when no feed has the team;
 *                         matched is the feed's own spelling of the team it was matched to
 *  GET /match?home=&away=&start=&sport=   both logos of ONE feed match (see below)
 */
module.exports = function publicRoutes({ config, logger }) {
  const logos = createTeamLogos({ config, logger });
  const router = Router();

  router.get(
    '/',
    validate({ query: z.object({ name: z.string().trim().min(1).max(120) }).strict() }),
    asyncHandler(async (req, res) => {
      const { name } = req.query;
      // Browsers may keep the answer for 10 minutes, the same as the server's own refresh.
      res.set('Cache-Control', 'public, max-age=600');
      response.ok(res, { name, ...(await logos.find(name)) });
    })
  );

  // GET /match?home=&away=&start=&sport= → { home: {logo, matched}, away: {logo, matched}, event }
  // `start`: our feed's "11/26/2026 1:40:00 PM" (IST), an epoch, or ISO. event is null when no
  // feed match has both teams near that start — then both logos are null.
  router.get(
    '/match',
    validate({
      query: z.object({
        home: z.string().trim().min(1).max(120),
        away: z.string().trim().min(1).max(120),
        start: z.string().trim().max(40).optional(),
        sport: z.string().trim().max(40).optional(),
      }).strict(),
    }),
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'public, max-age=600');
      response.ok(res, await logos.match(req.query));
    })
  );

  return router;
};
