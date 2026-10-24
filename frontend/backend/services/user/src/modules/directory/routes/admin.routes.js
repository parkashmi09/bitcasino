'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const { DirectoryService } = require('../directory.service');

/**
 * The player directory.
 *
 * `GET /users` was `SELECT * FROM users` on an unauthenticated route — every
 * player's bcrypt hash, email and phone number to anyone who asked.
 * `GET /user-summary` inflated every total by the row count of the other table.
 * `DELETE /deleteUser` erased a player from every table in the schema.
 *
 * ── SCOPING IS NOT AUTHORIZATION ────────────────────────────────────────
 *
 * Every call passes `staffId` so the service returns only the caller's own
 * subtree. That is the right shape, and it was the only control here — which
 * means any authenticated staff account could enumerate the players beneath
 * it with contact details attached. `users:read` is the grant that decides
 * whether the directory opens at all; the scoping then decides how much of it
 * is visible.
 *
 * The DELETE keeps `users:delete` even though the handler answers 501. The
 * grant documents what the route WOULD cost, so nobody wires a real
 * implementation behind a guard that was never there.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new DirectoryService(deps);
  const router = Router();

  const canRead = auth.requirePermission(PERMISSIONS.USERS_READ);

  const paging = {
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  };

  /**
   * @legacy GET /users
   * @legacy GET /getUserData
   */
  router.get(
    '/',
    canRead,
    validate({
      query: z
        .object({
          ...paging,
          search: z.string().trim().max(190).optional(),
          status: z.string().trim().max(30).optional(),
        })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const result = await service.list({ ...req.query, staffId: req.staff.id });
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    })
  );

  /** @legacy GET /user-summary */
  router.get(
    '/summary',
    canRead,
    validate({ query: z.object(paging).strict() }),
    asyncHandler(async (req, res) => {
      const result = await service.summary({ ...req.query, staffId: req.staff.id });
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    })
  );

  router.get(
    '/:userId',
    canRead,
    validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.get({ ...req.params, staffId: req.staff.id })))
  );

  /**
   * @legacy DELETE /deleteUser
   *
   * Answers 501 and says what to do instead. See `refuseDelete` for why there
   * is no correct version of the original.
   */
  router.delete(
    '/:userId',
    auth.requirePermission(PERMISSIONS.USERS_DELETE),
    validate({ params: z.object({ userId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) => response.ok(res, await service.refuseDelete({ ...req.params, actor: req.staff })))
  );

  return router;
};
