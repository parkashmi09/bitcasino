'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });
  const paged = async (res, q, promise) => {
    const result = await promise;
    return response.paginated(res, result.rows, { ...page(q), total: result.total });
  };

  return {
    /** @legacy GET /firebase/allToken */
    listDevices: asyncHandler(async (req, res) =>
      paged(res, req.query, service.listDevices({ ...req.query, staff: req.staff }))
    ),

    /** @legacy POST /firebase/send-to-user */
    sendToUser: asyncHandler(async (req, res) =>
      response.accepted(res, await service.sendToUser({ ...req.body, staff: req.staff }))
    ),

    /** @legacy POST /firebase/send-bulk */
    broadcast: asyncHandler(async (req, res) =>
      response.accepted(res, await service.broadcast({ ...req.body, staff: req.staff }))
    ),

    listSends: asyncHandler(async (req, res) => paged(res, req.query, service.listSends({ ...req.query, staff: req.staff }))),

    updateSend: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateSend({ ...req.body, sendId: req.params.sendId, staff: req.staff }))
    ),

    deleteSend: asyncHandler(async (req, res) =>
      response.ok(res, await service.deleteSend({ sendId: req.params.sendId, staff: req.staff }))
    ),

    /** @legacy GET /firebase/history/:userId */
    history: asyncHandler(async (req, res) =>
      paged(res, req.query, service.staffHistory({ ...req.query, userId: req.params.userId, staff: req.staff }))
    ),

    /** @legacy GET /firebase/unread-count/:userId */
    unreadCount: asyncHandler(async (req, res) =>
      response.ok(res, await service.staffUnreadCount({ userId: req.params.userId, staff: req.staff }))
    ),

    // ── Called by user-service on the player's behalf ──────────────────

    /** @legacy POST /firebase/register */
    registerDevice: asyncHandler(async (req, res) =>
      response.created(res, await service.registerDevice({ ...req.body, userId: req.body.userId }))
    ),

    /** @legacy POST /firebase/mark-as-read */
    markRead: asyncHandler(async (req, res) =>
      response.ok(res, await service.markRead({ ...req.body, userId: req.body.userId }))
    ),

    myHistory: asyncHandler(async (req, res) =>
      paged(res, req.query, service.history({ ...req.query, userId: req.body.userId ?? req.query.userId }))
    ),
  };
}

module.exports = { createControllers };
