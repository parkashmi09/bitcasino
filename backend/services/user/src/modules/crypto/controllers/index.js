'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    /**
     * @legacy POST /api/ccpaymentnotify
     *
     * The provider gets 200 in its own shape once the signature checks out —
     * whatever we then decide about the deposit. A 4xx on a money webhook makes
     * the provider retry forever against something that will never succeed.
     */
    webhook: asyncHandler(async (req, res) => {
      const result = await service.handleWebhook({
        // The RAW bytes. Re-serialising the parsed body can reorder keys and
        // produce a different digest from the one the provider signed.
        rawBody: req.rawBody?.toString('utf8') ?? '',
        signature: req.get('Sign'),
        timestamp: req.get('Timestamp'),
      });

      req.log?.info({ result }, 'CCPayment webhook handled');
      return res.status(200).send('success');
    }),

    /** @legacy POST /getCoinDetails */
    coinDetails: asyncHandler(async (req, res) => response.ok(res, await service.coinDetails(req.query))),

    /** @legacy GET /getAllChains */
    chains: asyncHandler(async (_req, res) => response.ok(res, await service.chains())),

    /** @legacy POST /inrhistory */
    inrHistory: asyncHandler(async (req, res) => {
      const result = await service.inrHistory({ ...req.query, userId: req.user.id });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),
  };
}

module.exports = { createControllers };
