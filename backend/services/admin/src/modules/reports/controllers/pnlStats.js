'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { PnlStatsService } = require('../pnlStats.service');

/**
 * The profit & loss routes. The caller is `req.staff` from the verified token,
 * never a parameter, so neither the tree nor the house-only cost lines can be
 * widened from the query string. `tz` is UTC-only and not passed on.
 */
function createPnlStatsControllers(deps) {
  const pnl = new PnlStatsService(deps);
  const args = (req) => ({
    staff: req.staff,
    from: req.query.from,
    to: req.query.to,
    granularity: req.query.granularity,
    currency: req.query.currency,
    channel: req.query.channel,
  });

  return {
    pnlSummary: asyncHandler(async (req, res) => response.ok(res, await pnl.summary(args(req)))),
    pnlBreakdown: asyncHandler(async (req, res) => response.ok(res, await pnl.breakdown(args(req)))),
  };
}

module.exports = { createPnlStatsControllers };
