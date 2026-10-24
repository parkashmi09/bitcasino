'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * The money API other services call.
 *
 * Every handler passes `sourceService` down from the authenticated internal
 * caller, so every ledger row records which service moved the money. "Who
 * debited this player" has an answer without correlating logs.
 */
function createInternalController({ service }) {
  const context = (req) => ({ sourceService: req.internalCaller });

  return {
    /** Take a stake. Fails with 402 rather than going negative. */
    debit: asyncHandler(async (req, res) => {
      const result = await service.debit(req.body, context(req));
      return response.ok(res, result);
    }),

    /** Pay out. */
    credit: asyncHandler(async (req, res) => {
      const result = await service.credit(req.body, context(req));
      return response.ok(res, result);
    }),

    /** Compensating reversal for a movement whose caller failed afterwards. */
    rollback: asyncHandler(async (req, res) => {
      const result = await service.rollback(req.body, context(req));
      return response.ok(res, result);
    }),

    transfer: asyncHandler(async (req, res) => {
      const result = await service.transfer(req.body, context(req));
      return response.ok(res, result);
    }),

    balance: asyncHandler(async (req, res) => {
      const { userId } = req.params;
      const { currency } = req.query;

      const data = currency
        ? { userId, currency, balance: await service.getBalance(userId, currency) }
        : { userId, balances: await service.getBalances(userId) };

      return response.ok(res, data);
    }),

    /** Wallet vs. its own ledger. For the reconciliation job. */
    reconcile: asyncHandler(async (req, res) => {
      const result = await service.reconcile({
        userId: req.params.userId,
        currency: req.query.currency,
      });
      return response.ok(res, result);
    }),
  };
}

module.exports = { createInternalController };
