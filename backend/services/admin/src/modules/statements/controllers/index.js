'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const { renderStatement } = require('../statementPdf');

function createControllers({ service }) {
  /** Both PDF routes build the payload the JSON route returns, then draw it. */
  const asPdf = (build) =>
    asyncHandler(async (req, res) => {
      const statement = await build(req);
      /**
       * The build can still throw — a subject outside the caller's tree — and
       * it does so BEFORE any byte of the PDF is written, so the error handler
       * can answer with JSON. Legacy piped the document first and then had
       * `if (!res.headersSent)` to decide whether an error could be reported.
       */
      return renderStatement(res, statement);
    });

  return {
    /** @legacy GET /api/admin/agent-report/:staffId/statement */
    agentStatement: asyncHandler(async (req, res) =>
      response.ok(res, await service.agentStatement({ staff: req.staff, ...req.params, ...req.query }))
    ),

    /** @legacy GET /api/admin/agent-report/user/:userId/statement */
    userStatement: asyncHandler(async (req, res) =>
      response.ok(res, await service.userStatement({ staff: req.staff, ...req.params, ...req.query }))
    ),

    /** @legacy GET /api/admin/agent-report/:staffId/bets */
    agentBets: asyncHandler(async (req, res) => {
      const result = await service.bets({ staff: req.staff, ...req.params, ...req.query });
      return response.paginated(res, result.rows, result.pagination, { kind: result.kind });
    }),

    /** @legacy GET /api/admin/agent-report/user/:userId/bets */
    userBets: asyncHandler(async (req, res) => {
      const result = await service.bets({ staff: req.staff, ...req.params, ...req.query });
      return response.paginated(res, result.rows, result.pagination, { kind: result.kind });
    }),

    /**
     * @legacy GET /api/admin/agent-report/:staffId/pdf
     * @legacy GET /api/admin/agent-report/:staffId
     *
     * Legacy served two different PDFs on these two paths — `statementPdf` on
     * `/pdf` and `ctrl.generateAgentReport` on the bare path — built from
     * different queries. One renderer here, so the bare path and `/pdf` are
     * the same document.
     */
    agentPdf: asPdf((req) => service.agentStatement({ staff: req.staff, ...req.params, ...req.query })),

    /** @legacy GET /api/admin/agent-report/user/:userId/pdf */
    userPdf: asPdf((req) => service.userStatement({ staff: req.staff, ...req.params, ...req.query })),
  };
}

module.exports = { createControllers };
