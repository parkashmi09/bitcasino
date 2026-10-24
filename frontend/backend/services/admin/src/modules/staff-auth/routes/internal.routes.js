'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

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
    validate({ query: z.object({ staffId: z.coerce.number().int().positive() }).strict() }),
    asyncHandler(async (req, res) => {
      const staff = await models.Staff.findByPk(req.query.staffId, {
        attributes: ['id', 'name', 'email', 'role_id', 'status'],
        raw: true,
      });

      /**
       * `{active: false}` rather than a 404.
       *
       * The caller's next step is identical for "no such staff" and "suspended
       * staff" — refuse the connection — and a 404 would make a transport
       * failure and a policy decision look the same to the code handling it.
       */
      const active = Boolean(staff) && staff.status !== 'disabled' && staff.status !== 'inactive';

      return response.ok(res, {
        active,
        staff: active ? { id: staff.id, name: staff.name, roleId: staff.role_id } : null,
      });
    })
  );

  return router;
};
