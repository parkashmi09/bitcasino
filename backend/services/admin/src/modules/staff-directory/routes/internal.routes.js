'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler, NotFoundError, ForbiddenError } = require('@ibitplay/common');

const {
  resolveStaff,
  descendantIds,
  verifyTransactionPassword,
  betLockState,
  betLockList,
  setBetLock,
  transfersForUser,
} = require('../staffDirectory.service');

/**
 * Staff identity, for the other services.
 *
 * `authenticateStaff()` in sports-service and casino-service calls this on
 * every staff request. It is therefore on the hot path — but it must stay a
 * live read, because caching it is precisely how a demoted account keeps its
 * authority. If this ever needs a cache, the TTL is the window during which a
 * lock does nothing, and it should be seconds, not minutes.
 */
const staffParams = {
  params: z.object({ staffId: z.coerce.number().int().positive() }),
  query: z.object({ executiveId: z.coerce.number().int().positive().optional() }),
};

module.exports = function internalRoutes({ models, logger }) {
  const router = Router();

  router.get(
    '/staff/:staffId',
    validate(staffParams),
    asyncHandler(async (req, res) => {
      const staff = await resolveStaff(models, req.params.staffId, req.query.executiveId);
      if (!staff) throw new NotFoundError('Staff account not found');
      return response.ok(res, staff);
    })
  );

  /**
   * Whose players this staff member may see.
   *
   * Asked for by every staff-scoped report in the other services. admin-service
   * answers because it owns the `staff` table; the alternative is each service
   * reading a table it does not own, which is how the legacy reports each ended
   * up with their own copy of the same recursive query.
   *
   * The id is a path parameter rather than a header on purpose. The caller has
   * already verified a staff token — this route is behind the internal key —
   * and a header named `x-staff-id` is exactly what the legacy version trusted.
   */
  router.get(
    '/staff/:staffId/descendants',
    validate({ params: z.object({ staffId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) => {
      const ids = await descendantIds(models, req.params.staffId, { logger });
      return response.ok(res, { staffId: req.params.staffId, ids });
    })
  );

  /**
   * The staff member's second factor, checked for another service.
   *
   * Payouts, balance adjustments and provider toggles all require it, and each
   * lives in a different service. None of them may read `staff`, so they ask.
   *
   * A wrong password is a 403 rather than a `{ok:false}` body on purpose: the
   * caller's `ServiceClient` throws on a non-2xx, so a service that forgets to
   * check the answer still fails closed. A boolean in a 200 would let a missing
   * `if` wave the action through.
   */
  router.post(
    '/verify-transaction-password',
    validate({
      body: z
        .object({
          staffId: z.coerce.number().int().positive(),
          transactionPassword: z.string().min(1).max(200),
        })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const { staffId, transactionPassword } = req.body;
      const valid = await verifyTransactionPassword(models, staffId, transactionPassword);

      if (!valid) {
        logger?.warn({ staffId }, 'Transaction password rejected');
        throw new ForbiddenError('Invalid transaction password');
      }

      return response.ok(res, { staffId, verified: true });
    })
  );

  /**
   * Is sports betting locked at or above this staff account.
   *
   * sports-service asks before taking a bet from a player whose
   * `parent_staff_id` is set. It fails CLOSED on its side if this is
   * unreachable — an unavailable lock check must not become a way to bet from
   * a locked hierarchy.
   */
  router.get(
    '/staff/:staffId/betlock',
    validate({ params: z.object({ staffId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await betLockState(models, req.params.staffId, { logger }))
    )
  );

  /** The staff accounts a caller may lock, with their current state. */
  router.get(
    '/staff/:staffId/betlock/list',
    validate({ params: z.object({ staffId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await betLockList(models, req.params.staffId, { logger }))
    )
  );

  /**
   * Lock or unlock a staff account's sports betting.
   *
   * Legacy's version was `UPDATE staff SET sports_betlocked = $1 WHERE id = $2`
   * on an unauthenticated route with no hierarchy check, so one request could
   * unlock any downline on the platform.
   *
   * A refusal is a 403, not a `{ok:false}` body: the caller's `ServiceClient`
   * throws on a non-2xx, so a service that forgets to read the answer still
   * fails closed.
   */
  router.post(
    '/staff/:staffId/betlock',
    validate({
      params: z.object({ staffId: z.coerce.number().int().positive() }),
      body: z
        .object({ locked: z.boolean(), actorStaffId: z.coerce.number().int().positive() })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const result = await setBetLock(
        models,
        { staffId: req.params.staffId, locked: req.body.locked, actorStaffId: req.body.actorStaffId },
        { logger }
      );
      if (!result.ok) throw new ForbiddenError(result.reason);
      return response.ok(res, result);
    })
  );

  /**
   * A player's transfers to and from staff.
   *
   * `staff_transfers` is admin-owned; user-service surfaces this on the
   * player's own statement and cannot read the table directly.
   */
  router.get(
    '/transfers/user/:userId',
    validate({
      params: z.object({ userId: z.coerce.number().int().positive() }),
      query: z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await transfersForUser(models, req.params.userId, req.query))
    )
  );

  return router;
};
