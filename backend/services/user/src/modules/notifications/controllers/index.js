'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /**
     * The rows go in `data` and the total in `meta`, which is the shape every
     * other paginated route on this service answers with.
     *
     * The total has to be REBUILT here rather than forwarded, because the
     * internal client drops `meta` on the way across — see the long note on
     * the internal route. So that route hands back `{ rows, total, limit,
     * offset }` in its `data`, and this turns it into the envelope a player
     * client expects.
     */
    list: asyncHandler(async (req, res) => {
      const { rows = [], total = 0, limit, offset } = await service.list({
        userId: req.user.id,
        ...req.query,
      });
      return response.ok(res, rows, {
        total,
        limit,
        offset,
        page: Math.floor((offset ?? 0) / (limit || 1)) + 1,
      });
    }),

    /** `{ unread, byCategory: { system, transactions, promotions } }`. */
    unreadCount: asyncHandler(async (req, res) => response.ok(res, await service.unreadCount({ userId: req.user.id }))),

    /** One row. The id is the caller's to name; ownership is enforced by the
        `user_id` in the update's WHERE, so naming somebody else's marks nothing. */
    readOne: asyncHandler(async (req, res) => {
      const result = await service.markRead({ userId: req.user.id, notificationIds: [req.params.id] });
      return response.ok(res, result?.data ?? result);
    }),

    /** Every unread one — no ids, which is what the service reads as "all". */
    readAll: asyncHandler(async (req, res) => {
      const result = await service.markRead({ userId: req.user.id });
      return response.ok(res, result?.data ?? result);
    }),
  };
}

module.exports = { createControllers };
