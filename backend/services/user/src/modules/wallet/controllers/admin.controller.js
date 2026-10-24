'use strict';

const { response, asyncHandler } = require('@ibitplay/common');
const { canIssueFunds, assertPlayerCapability } = require('@ibitplay/auth');

/** Staff wallet operations. */
function createAdminController({ service }) {
  return {
    /**
     * @legacy POST /updatebalance
     * @legacy POST /adminwalletadd
     */
    adjust: asyncHandler(async (req, res) => {
      await service.assertPlayerVisible(req.staff.id, req.body.userId);

      // One key per submit (body, or the standard header). The same key again is
      // a retry and is replayed with `replayed: true`; see `WalletService.adminAdjust`.
      const headerKey = req.headers?.['idempotency-key'];
      if (!req.body.idempotencyKey && headerKey && /^[A-Za-z0-9:_-]{8,80}$/.test(headerKey.trim())) {
        req.body = { ...req.body, idempotencyKey: headerKey.trim() };
      }

      /**
       * ONLY the platform owner creates money. Every other staff session —
       * Admin and Sub Admin included, and any executive — moves money between
       * its OWN float and its DIRECT player (`users.parent_staff_id` = caller),
       * made atomically by admin-service, which owns the float and checks both
       * the direct-parent rule and the transaction password.
       * See `WalletService.agentAdjust` and `LordsService.adjustPlayer`.
       *
       * This used to branch on `isAgentTree`, so house staff (levels 1–3) all
       * took the operator adjustment: a Sub Admin with a zero balance could
       * credit any player on the site and nothing was debited.
       */
      if (!canIssueFunds(req.staff)) {
        return response.ok(res, await service.agentAdjust(req.body, { staffId: req.staff.id, executiveId: req.staff.executiveId ?? null }));
      }

      /**
       * Owner, INR: owner ka balance ab `credits` me hai (migration 099), isliye
       * ye bhi admin-service se jaata hai. Wahan decide hota hai:
       *   - player ka parent hai → owner ke wallet se katega
       *   - direct user (koi parent nahi) → owner ka wallet nahi katega
       * Doosre coins (BTC, USDT …) pehle jaise operator adjustment hi rehte hain.
       */
      if (String(req.body.currency).toUpperCase() === 'INR') {
        return response.ok(res, await service.agentAdjust(req.body, { staffId: req.staff.id }));
      }

      // Child user (koi parent) ka paisa sirf Sports Exchange INR (D/W) se — doosre coin me
      // operator adjustment nahi (403 DEPOSIT_NOT_FOR_AGENT_USERS).
      await assertPlayerCapability(req.body.userId, 'deposit');

      await service.checkTransactionPassword(req.staff.id, req.body.transactionPassword, {
        required: true,
        executiveId: req.staff.executiveId ?? null,
      });
      const result = await service.adminAdjust(req.body, {
        staffId: req.staff.id,
        sourceService: 'admin-ui',
      });

      // `previousBalance`/`newBalance` are additive — the legacy admin UI had
      // to re-fetch the wallet after every adjustment to show the result.
      return response.ok(res, result);
    }),

    balances: asyncHandler(async (req, res) => {
      await service.assertPlayerVisible(req.staff.id, req.params.userId);
      const balances = await service.getBalances(req.params.userId);
      return response.ok(res, { userId: req.params.userId, balances });
    }),

    /** @legacy GET /getwallet */
    list: asyncHandler(async (req, res) => {
      const { search, heldCurrency, limit, offset } = req.query;
      const result = await service.listBalances({
        staffId: req.staff.id,
        search,
        heldCurrency,
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
      await service.assertPlayerVisible(req.staff.id, req.params.userId);
      const { limit, offset, currency } = req.query;
      const result = await service.listStaffHistory({
        userId: req.params.userId, currency, limit, offset,
      });
      return res.json({ history: result.rows, count: result.count });
    }),

    reconcile: asyncHandler(async (req, res) => {
      await service.assertPlayerVisible(req.staff.id, req.params.userId);
      // A currency: that one report, as before. None: every currency the wallet has.
      const result = req.query.currency
        ? await service.reconcile({ userId: req.params.userId, currency: req.query.currency })
        : await service.reconcileAll({ userId: req.params.userId });
      return response.ok(res, result);
    }),
  };
}

module.exports = { createAdminController };
