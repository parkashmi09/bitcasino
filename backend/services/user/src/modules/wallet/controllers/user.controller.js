'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * A player's view of their own wallet.
 *
 * The user id always comes from `req.user.id` — the verified token — never from
 * a parameter. There is deliberately no endpoint here that MOVES money: a
 * player cannot credit themselves, and every balance change originates from a
 * bet, a deposit, or an operator.
 */
function createUserController({ service }) {
  return {
    /** @legacy GET /getwallet */
    balances: asyncHandler(async (req, res) => {
      const balances = await service.getBalances(req.user.id);
      return response.ok(res, balances);
    }),

    /** @legacy GET /user/api/balance — took `uid` and `coin_symbol` from the query */
    balanceOf: asyncHandler(async (req, res) => {
      const balances = await service.getBalances(req.user.id);
      const currency = req.params.currency.toUpperCase();
      const found = Array.isArray(balances)
        ? balances.find((b) => String(b.currency).toUpperCase() === currency)
        : balances?.[currency];

      // Absent means zero, not missing: every player holds every currency, they
      // just hold none of most of them.
      return response.ok(res, { currency, balance: found?.balance ?? found ?? '0' });
    }),

    /** @legacy GET /wallethistory/:uid */
    history: asyncHandler(async (req, res) => {
      const { limit, offset, currency } = req.query;
      const result = await service.listHistory({ userId: req.user.id, currency, limit, offset });

      // The legacy client parses `{ history, count }`, so that shape is kept
      // verbatim rather than moved into the platform envelope.
      return res.json({ history: result.rows, count: result.count });
    }),

    ledger: asyncHandler(async (req, res) => {
      const { limit, offset, currency, reason } = req.query;
      const result = await service.listLedger({ userId: req.user.id, currency, reason, limit, offset });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),
  };
}

module.exports = { createUserController };
