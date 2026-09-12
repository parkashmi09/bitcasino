'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../audit.validators');
const { AuditService } = require('../audit.service');

/** Reading the audit trail. Write access is internal-only — staff cannot forge entries. */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new AuditService(deps);
  const router = Router();

  router.get(
    '/activity',
    auth.requirePermission(PERMISSIONS.AUDIT_READ),
    validate(v.listActivity),
    asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      // The caller decides the scope — the trail is read down their own tree.
      const result = await service.list({ ...req.query, actor: req.staff });
      return response.paginated(res, result, {
        page: Math.floor(offset / limit) + 1,
        limit,
        total: result.count,
      });
    })
  );

  return router;
};
