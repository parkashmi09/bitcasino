'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { WagerReportService } = require('../wagerReport.service');
const { RaceTurnoverService } = require('../raceTurnover.service');

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

/**
 * The race leaderboard's window.
 *
 * `from` and `to` are REQUIRED here, unlike `/turnover/:userId` where an absent
 * pair means "all history". A race is a window by definition, and defaulting to
 * all-time would answer with every bet ever placed under the heading of one
 * day's competition.
 */
const raceWindow = {
  query: z
    .object({
      from: z.string().trim().min(8).max(35),
      to: z.string().trim().min(8).max(35),
    })
    .strict(),
};

module.exports = function internalRoutes(deps) {
  const service = new WagerReportService(deps);
  const race = new RaceTurnoverService(deps);
  const router = Router();

  /**
   * Every player's turnover in a window, by game bucket and currency.
   *
   * Internal, like its neighbour, and for a stronger reason: this one is not
   * scoped to a single player at all. It is the whole platform's stake volume
   * for a period, which is commercially sensitive on its own.
   */
  router.get(
    '/race-points',
    validate(raceWindow),
    asyncHandler(async (req, res) => response.ok(res, await race.racePoints(req.query)))
  );

  router.get(
    '/turnover/:userId',
    validate(params),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.turnover({ userId: req.params.userId, ...req.query }))
    )
  );

  return router;
};
