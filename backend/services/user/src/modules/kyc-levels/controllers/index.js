'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/** Same headers as the identity KYC's documents: a download, never cached, never sniffed. */
function sendDocument(res, { buffer, contentType, filename }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(buffer);
}

function createControllers({ service }) {
  return {
    status: asyncHandler(async (req, res) => response.ok(res, await service.status(req.user.id))),
    submit: asyncHandler(async (req, res) =>
      response.created(res, await service.submit(req.user.id, Number(req.params.level), req.file))
    ),
    myDocument: asyncHandler(async (req, res) => sendDocument(res, await service.myDocument(req.user.id, Number(req.params.level)))),
    list: asyncHandler(async (req, res) => response.ok(res, await service.list(req.staff, req.query))),
    review: asyncHandler(async (req, res) => response.ok(res, await service.review(req.staff, req.params.id, req.body))),
    documentForStaff: asyncHandler(async (req, res) => sendDocument(res, await service.documentForStaff(req.staff, req.params.id))),
  };
}

module.exports = { createControllers };
