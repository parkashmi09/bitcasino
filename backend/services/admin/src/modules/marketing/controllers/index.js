'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy GET /marketing/me */
    me: asyncHandler(async (req, res) => response.ok(res, await service.me({ executive: req.marketing }))),

    /** @legacy GET /marketing/analytics/signups */
    signups: asyncHandler(async (req, res) => response.ok(res, await service.signups(req.query))),

    /** @legacy GET /marketing/analytics/deposits */
    deposits: asyncHandler(async (req, res) => response.ok(res, await service.deposits(req.query))),

    /** @legacy GET /marketing/analytics/retention */
    retention: asyncHandler(async (req, res) => response.ok(res, await service.retention(req.query))),

    /** @legacy GET /marketing/analytics/top-agents */
    topAgents: asyncHandler(async (req, res) => response.ok(res, await service.topAgents(req.query))),

    /** @legacy GET /marketing/customers */
    customers: asyncHandler(async (req, res) => {
      const result = await service.customers(req.query);
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    }),
  };
}

module.exports = { createControllers };
