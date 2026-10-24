'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, z, ForbiddenError } = require('@ibitplay/common');
const { PERMISSIONS, STAFF_LEVELS, effectiveStaffLevel } = require('@ibitplay/auth');

const { OriginalGamesAdminService } = require('../originalGames.service');
const { GRANULARITIES, MAX_SPAN_DAYS, MAX_COARSE_SPAN_DAYS, MAX_HOURLY_SPAN_DAYS } = require('../../reports/stats.shared');

const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest window per bucket size, as the wager report allows. */
const MAX_DAYS = { hour: MAX_HOURLY_SPAN_DAYS, day: MAX_SPAN_DAYS, week: MAX_COARSE_SPAN_DAYS, month: MAX_COARSE_SPAN_DAYS };
const channel = z.enum(['direct', 'agent']).optional();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, 'Not a currency code').optional();
const tz = z
  .string()
  .trim()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

const v = {
  stats: {
    query: z
      .object({
        channel,
        currency,
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        granularity: z.enum(GRANULARITIES).default('day'),
        tz: tz.default('UTC'),
      })
      .strict()
      .refine((q) => !q.from || !q.to || q.from < q.to, { message: '`from` must be before `to`', path: ['from'] })
      .refine((q) => !q.from || ((q.to ?? new Date()).getTime() - q.from.getTime()) / DAY_MS <= MAX_DAYS[q.granularity], {
        message: `The range may cover at most ${MAX_SPAN_DAYS} days by the day, ${MAX_COARSE_SPAN_DAYS} by the week or month, ${MAX_HOURLY_SPAN_DAYS} by the hour`,
        path: ['to'],
      }),
  },
  bets: {
    query: z
      .object({
        channel,
        currency,
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        game: z.string().trim().min(1).max(64).optional(),
        status: z.enum(['won', 'lost', 'open', 'refunded']).optional(),
        search: z.string().trim().min(1).max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .strict(),
  },
  games: { query: z.object({ channel }).strict() },
};

/**
 * Admin → Casino → Original Games. `originals:read` AND the Super Admin's own tree — the Super
 * Admin, or one of its executives (an executive's token carries its parent's level).
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new OriginalGamesAdminService(deps);
  const router = Router();

  const superAdminOnly = (req, _res, next) =>
    effectiveStaffLevel(req.staff) === STAFF_LEVELS.SUPER_ADMIN ? next() : next(new ForbiddenError('Original Games is for the Super Admin only'));
  router.use(auth.requirePermission(PERMISSIONS.ORIGINALS_READ), superAdminOnly);

  router.get('/stats', validate(v.stats), asyncHandler(async (req, res) => response.ok(res, await service.stats({ staff: req.staff, ...req.query }))));

  router.get(
    '/bets',
    validate(v.bets),
    asyncHandler(async (req, res) => {
      const { rows, total } = await service.bets(req.query);
      return response.paginated(res, rows, { page: req.query.page, limit: req.query.limit, total });
    })
  );

  router.get('/games', validate(v.games), asyncHandler(async (req, res) => response.ok(res, await service.games(req.query))));

  return router;
};
