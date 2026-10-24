'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { WagerReportService } = require('../wagerReport.service');

/**
 * Sports turnover, for the services that need it to decide whether a reward
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
 * A race's window. Required, not optional: unlike `/turnover/:userId`, where an
 * absent pair means all history, a race IS a window — defaulting would answer
 * with every bet ever placed under one day's heading.
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
  const router = Router();

  /**
   * Every player's sports turnover in a window. Internal for a stronger reason
   * than its neighbour: this is not scoped to one player, it is the platform's
   * whole stake volume for a period.
   */
  router.get(
    '/race-points',
    validate(raceWindow),
    asyncHandler(async (req, res) => response.ok(res, await service.racePoints(req.query)))
  );

  router.get(
    '/turnover/:userId',
    validate(params),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.turnover({ userId: req.params.userId, ...req.query }))
    )
  );

  /** One player's settled sports bets per currency, for their own profile. */
  router.get(
    '/player/:userId/profile-stats',
    validate({ params: params.params }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.profileStats({ userId: req.params.userId }))
    )
  );

  return router;
};
