'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/** Staff wallet operations. */
function createAdminController({ service }) {
  return {
    /**
     * @legacy POST /updatebalance
     * @legacy POST /adminwalletadd
     */
    adjust: asyncHandler(async (req, res) => {
      const result = await service.adminAdjust(req.body, {
        staffId: req.staff.id,
        sourceService: 'admin-ui',
      });

      // `previousBalance`/`newBalance` are additive — the legacy admin UI had
      // to re-fetch the wallet after every adjustment to show the result.
      return response.ok(res, result);
    }),

    balances: asyncHandler(async (req, res) => {
      const balances = await service.getBalances(req.params.userId);
      return response.ok(res, { userId: req.params.userId, balances });
    }),

    /** @legacy GET /getwallet */
    list: asyncHandler(async (req, res) => {
      const { search, limit, offset } = req.query;
      const result = await service.listBalances({
        staffId: req.staff.id,
        search,
        limit,
        offset,
      });

      return response.paginated(res, result.rows, {
        page: Math.floor(offset / limit) + 1,
        limit,
        total: result.total,
      });
    }),

    /** @legacy GET /wallethistory/:uid */
    history: asyncHandler(async (req, res) => {
      const { limit, offset, currency } = req.query;
      const result = await service.listHistory({
        userId: req.params.userId, currency, limit, offset,
      });
      return res.json({ history: result.rows, count: result.count });
    }),

    reconcile: asyncHandler(async (req, res) => {
      const result = await service.reconcile({
        userId: req.params.userId,
        currency: req.query.currency,
      });
      return response.ok(res, result);
    }),
  };
}

module.exports = { createAdminController };
