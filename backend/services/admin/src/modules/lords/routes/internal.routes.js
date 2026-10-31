'use strict';

const { Router } = require('express');
const { validate, z, response, asyncHandler } = require('@ibitplay/common');

const { LordsService } = require('../lords.service');

/**
 * Agent-tree money, for user-service.
 *
 * `POST /internal/admin/accounts/player-adjust` — the wallet adjust route lives
 * in user-service, but for an agent-tree caller it is a transfer between the
 * agent's float (the staff `credits` row, StaffCredits) and the player's wallet, and
 * only this service loads both. user-service forwards the verified staff id
 * from the token; the transaction password and the tree are checked again
 * here, so this route trusts the internal key for the CALLER, not for the
 * decision.
 *
 * The idempotency key makes a retry by `ServiceClient` (or a double-click)
 * a replay rather than a second movement.
 */
const amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a positive decimal with at most 8 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

const playerAdjust = {
  body: z
    .object({
      staffId: z.coerce.number().int().positive(),
      userId: z.coerce.number().int().positive(),
      currency: z.string().trim().min(1).max(12),
      amount,
      operation: z.enum(['credit', 'debit']),
      description: z.string().trim().min(1).max(500),
      idempotencyKey: z.string().min(1).max(120),
      username: z.string().max(200).nullish(),
      transactionPassword: z.string().max(200).optional(),
      // An executive session: its OWN login password is checked (TXN_PASSWORD_MODE=login).
      executiveId: z.coerce.number().int().positive().nullish(),
    })
    .strict(),
};

module.exports = function internalRoutes(deps) {
  const service = new LordsService(deps);
  const router = Router();

  router.post(
    '/player-adjust',
    validate(playerAdjust),
    asyncHandler(async (req, res) => {
      const { staffId, executiveId, ...rest } = req.body;
      return response.ok(res, await service.adjustPlayer({ ...rest, actor: { id: staffId, executiveId: executiveId ?? null } }));
    })
  );

  router.get(
    '/float/:staffId',
    validate({ params: z.object({ staffId: z.coerce.number().int().positive() }) }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.myFloat({ actor: { id: req.params.staffId } }))
    )
  );

  return router;
};
