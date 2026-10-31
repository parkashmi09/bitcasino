'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler } = require('@ibitplay/common');

const v = require('../transactionHistory.validators');
const { TransactionHistoryService } = require('../transactionHistory.service');

/**
 * `GET /internal/user/history/branch` — admin-service's branch reports (modules/branches): every
 * deposit or withdrawal, on every rail and in every status, of one branch's players. admin-service
 * checks who may ask and that `userId`, when given, is that branch's player.
 */
module.exports = function internalRoutes(deps) {
  const service = new TransactionHistoryService(deps);
  const router = Router();

  router.get(
    '/branch',
    validate(v.branch),
    asyncHandler(async (req, res) => {
      const { kind, ...query } = req.query;
      return response.ok(res, kind === 'withdrawals' ? await service.allWithdrawals(query) : await service.allDeposits(query));
    })
  );

  return router;
};
