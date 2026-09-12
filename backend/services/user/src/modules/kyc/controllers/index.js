'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

function createControllers({ service }) {
  return {
    /** @legacy GET /kyc/status/:userId */
    status: asyncHandler(async (req, res) => response.ok(res, await service.getStatus(req.user.id))),

    /** @legacy POST /kyc/submit */
    submit: asyncHandler(async (req, res) => {
      // multer gives `req.files` as { field: [file] }; flatten to one per field.
      const files = Object.fromEntries(
        Object.entries(req.files || {}).map(([field, list]) => [field, list[0]])
      );

      const result = await service.submit({ userId: req.user.id, details: req.body, files });
      return response.created(res, result);
    }),

    /** A player reading their own document. */
    myDocument: asyncHandler(async (req, res) => {
      const doc = await service.readDocument({
        kycId: req.params.kycId,
        field: req.params.field,
        requesterId: req.user.id,
        isStaff: false,
      });
      return sendDocument(res, doc);
    }),

    // ── Staff ─────────────────────────────────────────────────────────

    /** @legacy PUT /kyc/update-status */
    review: asyncHandler(async (req, res) => response.ok(res, await service.review(req.body, req.staff))),

    /** @legacy GET /kyc/admin/applications */
    list: asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.listApplications(req.query);
      return response.paginated(res, result, { page: Math.floor(offset / limit) + 1, limit });
    }),

    /** @legacy GET /kyc/documents/:filename */
    staffDocument: asyncHandler(async (req, res) => {
      const doc = await service.readDocument({
        kycId: req.params.kycId,
        field: req.params.field,
        requesterId: req.staff.id,
        isStaff: true,
      });
      return sendDocument(res, doc);
    }),
  };
}

/**
 * Send an identity document.
 *
 * `no-store` and `Content-Disposition: attachment` are deliberate: a passport
 * scan should not sit in a shared browser cache, and it should not render
 * inline where a crafted file could be interpreted as markup.
 */
function sendDocument(res, { buffer, contentType, filename }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(buffer);
}

module.exports = { createControllers };
