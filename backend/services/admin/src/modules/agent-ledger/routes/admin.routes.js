'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, z } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const { AgentLedgerService } = require('../agentLedger.service');

const amount = z.string().trim().regex(/^\d+(\.\d{1,2})?$/).optional();

const v = {
  list: {
    query: z
      .object({
        direction: z.enum(['deposit', 'withdraw']),
        search: z.string().trim().regex(/^\d{1,20}$/, 'search by ID').optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        min: amount,
        max: amount,
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict(),
  },
};

/** GET /admin/agent-ledger — Agent System deposit / withdraw (point ledger), apne tree ka. users:read. */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const service = new AgentLedgerService(deps);
  const router = Router();

  router.get(
    '/',
    auth.requirePermission(PERMISSIONS.USERS_READ),
    validate(v.list),
    // { total, sum, rows } — sum = filter ke hisaab se poora jod (sirf is page ka nahi).
    asyncHandler(async (req, res) => response.ok(res, await service.list({ ...req.query, actor: { id: req.staff.id, level: req.staff.level } })))
  );

  return router;
};
