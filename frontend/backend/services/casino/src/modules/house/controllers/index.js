'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const ticker = require('../ticker');
const { TICK_INTERVAL_MS } = require('../house.constants');

function createControllers({ service, logger }) {
  return {
    /** @legacy GET /gethouse */
    list: asyncHandler(async (req, res) => {
      const result = await service.list(req.query);
      return response.paginated(res, result.rows, {
        page: Math.floor(req.query.offset / req.query.limit) + 1,
        limit: req.query.limit,
        total: result.total,
      });
    }),

    /** @legacy POST /updatehouse */
    update: asyncHandler(async (req, res) =>
      response.ok(res, await service.update({ actor: req.staff, ...req.body }))
    ),

    /**
     * @legacy GET /reset-house
     * @legacy GET /win-house
     *
     * Both legacy routes rewrote every row with no WHERE clause, on a GET.
     */
    bulkSet: asyncHandler(async (req, res) =>
      response.ok(res, await service.bulkSet({ actor: req.staff, ...req.body }))
    ),

    /**
     * @legacy GET /start-house
     * @legacy GET /stop-house
     *
     * One route with a boolean, because two routes that mutate a singleton are
     * how the leak happened — see `ticker.js`.
     */
    ticker: asyncHandler(async (req, res) => {
      const result = req.body.running
        ? ticker.start(() => service.tick(), { intervalMs: TICK_INTERVAL_MS, logger })
        : ticker.stop({ logger });
      return response.ok(res, result);
    }),

    status: asyncHandler(async (_req, res) => response.ok(res, { running: ticker.isRunning() })),

    /**
     * @legacy GET /hour
     *
     * Legacy answered `new Date().getHours()` — the SERVER's local hour, with
     * nothing to say which zone that was. A client in another zone could not
     * interpret it.
     */
    clock: asyncHandler(async (_req, res) => {
      const now = new Date();
      return response.ok(res, {
        hour: now.getUTCHours(),
        iso: now.toISOString(),
        // What legacy returned, kept for a client that depends on it.
        serverHour: now.getHours(),
        serverOffsetMinutes: -now.getTimezoneOffset(),
      });
    }),
  };
}

module.exports = { createControllers };
