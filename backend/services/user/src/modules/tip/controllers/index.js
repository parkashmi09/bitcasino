'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    send: asyncHandler(async (req, res) =>
      response.created(res, await service.send({ ...req.body, userId: req.user.id }))
    ),

    users: asyncHandler(async (req, res) =>
      response.ok(res, await service.searchUsers({ userId: req.user.id, q: req.query.q }))
    ),

    settings: asyncHandler(async (req, res) =>
      response.ok(res, await service.getSettings({ userId: req.user.id }))
    ),

    updateSettings: asyncHandler(async (req, res) =>
      response.ok(res, await service.updateSettings({ userId: req.user.id, enabled: req.body.enabled }))
    ),

    history: asyncHandler(async (req, res) =>
      response.ok(res, await service.history({ ...req.query, userId: req.user.id }))
    ),

    // ── Staff ─────────────────────────────────────────────────────────

    adminList: asyncHandler(async (req, res) =>
      response.ok(res, await service.adminList({ ...req.query, staff: req.staff }))
    ),
  };
}

module.exports = { createControllers };
