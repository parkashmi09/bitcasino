'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * The player handlers take the id from the token; the staff handlers take it
 * from the URL. That difference is the whole point — legacy had only the URL
 * form, unauthenticated.
 */
function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    // ── Player: own history ───────────────────────────────────────────

    /** @legacy GET /depositHistory/user/crypto/deposits/:userId */
    myCryptoDeposits: asyncHandler(async (req, res) =>
      response.paginated(res, await service.cryptoDeposits({ ...req.query, userId: req.user.id }), page(req.query))
    ),

    /** @legacy GET /depositHistory/user/crypto/stats/:userId */
    myCryptoStats: asyncHandler(async (req, res) =>
      response.ok(res, await service.cryptoStats({ ...req.query, userId: req.user.id }))
    ),

    /** @legacy GET /depositHistory/user/fiat/deposits/:userId */
    myFiatDeposits: asyncHandler(async (req, res) =>
      response.paginated(res, await service.fiatDeposits({ ...req.query, userId: req.user.id }), page(req.query))
    ),

    /** @legacy GET /depositHistory/user/fiat/stats/:userId */
    myFiatStats: asyncHandler(async (req, res) =>
      response.ok(res, await service.fiatStats({ ...req.query, userId: req.user.id }))
    ),

    /**
     * @legacy GET /api/depositNew
     *
     * Every deposit rail, one shape. `/crypto/deposits` and `/fiat/deposits`
     * stay for a caller that wants one table; this is the statement.
     */
    myDeposits: asyncHandler(async (req, res) =>
      response.paginated(res, await service.allDeposits({ ...req.query, userId: req.user.id }), page(req.query))
    ),

    /**
     * @legacy GET /api/withdrawNew
     * @legacy GET /user/withdrawals/:userId
     *
     * Crypto, manual fiat and A-Pay payouts together. This used to return the
     * `fiat_withdrawals` table alone, so a crypto payout showed up nowhere.
     */
    myWithdrawals: asyncHandler(async (req, res) =>
      response.paginated(res, await service.allWithdrawals({ ...req.query, userId: req.user.id }), page(req.query))
    ),

    /** @legacy GET /user/withdrawals/stats/:userId */
    myWithdrawalStats: asyncHandler(async (req, res) =>
      response.ok(res, await service.withdrawalStats({ ...req.query, userId: req.user.id }))
    ),

    /** @legacy GET /sportsbetting/transfers/:userUuid */
    myTransfers: asyncHandler(async (req, res) => {
      const result = await service.staffTransfers({ ...req.query, userId: req.user.id });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    myCombined: asyncHandler(async (req, res) =>
      response.ok(res, await service.combined({ ...req.query, userId: req.user.id }))
    ),

    // ── Staff: anyone's history ───────────────────────────────────────

    /**
     * The platform-wide deposit reports that used to live here — crypto and
     * fiat listings and their totals — moved to `modules/deposit-reports`.
     *
     * They were reading the wrong tables (`deposits` rather than `ccdeposit`,
     * and only one of the four fiat provider tables), and more importantly they
     * had no agent-tree scoping: any staff member with `deposits:read` saw the
     * whole platform, where the legacy version — for all its faults — at least
     * limited an agent to their own downline.
     *
     * What stays here is a player's own history, a staff lookup of ONE named
     * player, and the two flat queue listings below. What moved is
     * AGGREGATE reporting across players — totals, stats — which needs the
     * staff hierarchy and therefore a call to admin-service.
     */

    /**
     * @legacy GET /deposits
     * @legacy GET /getDepositData
     *
     * The `deposits` table, flat and paged. Legacy served it twice: once as
     * `SELECT * FROM deposits` with a per-row USDT conversion, and once with a
     * `JOIN users` for the name. Both unauthenticated.
     */
    deposits: asyncHandler(async (req, res) =>
      response.paginated(res, await service.cryptoDeposits(req.query), page(req.query))
    ),

    withdrawals: asyncHandler(async (req, res) =>
      response.paginated(res, await service.withdrawals(req.query), page(req.query))
    ),

    userCombined: asyncHandler(async (req, res) =>
      response.ok(res, await service.combined({ ...req.query, userId: req.params.userId }))
    ),
  };
}

module.exports = { createControllers };
