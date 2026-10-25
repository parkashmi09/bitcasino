'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { assertTransactionPassword } = require('../transactionPassword');

/**
 * Confirming that a staff id is still an ACTIVE staff member.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY ANOTHER SERVICE NEEDS TO ASK
 *
 * user-service's socket transport accepts staff connections, because four
 * moderation events — mute, avatar, post-as, broadcast — have to run where the
 * player sockets are. Two of them broadcast, and there is no Socket.IO
 * cross-process adapter, so an emit from admin-service would reach nobody.
 *
 * A verified `ADMIN` token proves who signed in. It does not prove they are
 * still allowed to be here: tokens last eight hours, and a staff member
 * disabled at 09:00 keeps a working one until 17:00. `staff` is in the `admin`
 * model domain, which user-service deliberately does not load — that boundary
 * is the point of the split — so the question is asked over the internal API
 * instead of by reaching into another service's tables.
 *
 * Legacy's equivalent check, on the four events this exists for, was
 * `if (!privates) return;` — a boolean read out of the caller's own message.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function internalRoutes(deps) {
  const { models } = deps;
  const router = Router();

  router.get(
    '/verify',
    validate({
      query: z
        .object({
          staffId: z.coerce.number().int().positive(),
          tv: z.coerce.number().int().min(0).optional(),
          executiveId: z.coerce.number().int().positive().optional(),
          etv: z.coerce.number().int().min(0).optional(),
        })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const staff = await models.Staff.findByPk(req.query.staffId, {
        attributes: ['id', 'name', 'email', 'role_id', 'status', 'token_version'],
        raw: true,
      });

      /**
       * `{active: false}` rather than a 404.
       *
       * The caller's next step is identical for "no such staff" and "suspended
       * staff" — refuse the connection — and a 404 would make a transport
       * failure and a policy decision look the same to the code handling it.
       */
      // `tv`: the token's version; logout / password change bump it to end older tokens.
      let current = req.query.tv === undefined || Number(staff?.token_version ?? 0) === req.query.tv;
      // An executive's own logout bumps `executives.token_version` (`etv`).
      if (current && req.query.executiveId) {
        const executive = await models.Executives.findByPk(req.query.executiveId, { attributes: ['status', 'token_version'], raw: true });
        current = Boolean(executive) && executive.status === 'active' && Number(executive.token_version ?? 0) === (req.query.etv ?? 0);
      }
      const active = Boolean(staff) && staff.status !== 'disabled' && staff.status !== 'inactive' && current;

      return response.ok(res, {
        active,
        staff: active ? { id: staff.id, name: staff.name, roleId: staff.role_id } : null,
      });
    })
  );

  /**
   * The transaction-password check for a money move in another service.
   *
   * `required: false` enforces it only when the account has one set (house
   * wallet adjust); `required: true` refuses an account without one. A refusal
   * is a 403 with a `TXN_PASSWORD_*` code — the caller's `ServiceClient`
   * throws on a non-2xx and keeps the code, so the admin UI can tell "wrong"
   * from "not set yet".
   */
  router.post(
    '/transaction-password/check',
    validate({
      body: z
        .object({
          staffId: z.coerce.number().int().positive(),
          transactionPassword: z.string().max(200).optional(),
          required: z.boolean().default(true),
          executiveId: z.coerce.number().int().positive().nullish(),
        })
        .strict(),
    }),
    asyncHandler(async (req, res) => {
      const { staffId, transactionPassword, required, executiveId } = req.body;
      return response.ok(
        res,
        await assertTransactionPassword(models, staffId, transactionPassword, { required, executiveId: executiveId ?? null })
      );
    })
  );

  return router;
};
