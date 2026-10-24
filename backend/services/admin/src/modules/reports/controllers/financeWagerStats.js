'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { FinanceStatsService } = require('../financeStats.service');
const { WagerStatsService } = require('../wagerStats.service');

/**
 * The chart endpoints behind the finance screens and the wager reports.
 *
 * The caller is `req.staff` from the verified token — never a parameter — so
 * the tree each figure is scoped to cannot be widened from the query string.
 */
function createFinanceWagerStatsControllers(deps) {
  const finance = new FinanceStatsService(deps);
  const wager = new WagerStatsService(deps);

  return {
    financeStats: asyncHandler(async (req, res) =>
      response.ok(res, await finance.stats({ staff: req.staff, ...req.query }))
    ),
    wagerStats: asyncHandler(async (req, res) =>
      response.ok(res, await wager.stats({ staff: req.staff, ...req.query }))
    ),
  };
}

module.exports = { createFinanceWagerStatsControllers };
