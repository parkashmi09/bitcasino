'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy POST /api/deposits/create */
    create: asyncHandler(async (req, res) =>
      response.created(res, await service.create({
        userId: req.user.id,
        details: req.body,
        screenshot: req.file,
      }))
    ),

    /** @legacy GET /api/deposits/user-deposits */
    listMine: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listForUser({ userId: req.user.id, ...req.query });
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    /** @legacy GET /api/deposits/deposit/:depositId */
    getMine: asyncHandler(async (req, res) =>
      response.ok(res, await service.getForUser({ depositId: req.params.depositId, userId: req.user.id }))
    ),

    /** @legacy GET /api/deposits/screenshot/:depositId */
    myScreenshot: asyncHandler(async (req, res) =>
      sendFile(res, await service.readScreenshot({
        depositId: req.params.depositId, requesterId: req.user.id, isStaff: false,
      }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy GET /api/deposits/admin/all-deposits */
    listAll: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listAll(req.query);
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    /** @legacy GET /api/deposits/admin/pending-deposits */
    listPending: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listPending(req.query);
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    /** @legacy PUT /api/deposits/admin/approve/:depositId */
    approve: asyncHandler(async (req, res) =>
      response.ok(res, await service.approve({ depositId: req.params.depositId, ...req.body }, req.staff))
    ),

    /** @legacy PUT /api/deposits/admin/reject/:depositId */
    reject: asyncHandler(async (req, res) =>
      response.ok(res, await service.reject({ depositId: req.params.depositId, ...req.body }, req.staff))
    ),

    staffScreenshot: asyncHandler(async (req, res) =>
      sendFile(res, await service.readScreenshot({
        depositId: req.params.depositId, requesterId: req.staff.id, isStaff: true,
      }))
    ),
  };
}

/** Proof of payment is a bank document — never cached, never rendered inline. */
function sendFile(res, { buffer, contentType, filename }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(buffer);
}

module.exports = { createControllers };
