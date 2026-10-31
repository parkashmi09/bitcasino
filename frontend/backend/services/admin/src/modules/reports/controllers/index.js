'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const csv = require('../csv');
const { renderStatement } = require('../../statements/statementPdf');
const { StatementsService } = require('../../statements/statements.service');

function createControllers({ service, deps }) {
  const page = (q) => ({ page: Math.floor(q.offset / q.limit) + 1, limit: q.limit });

  return {
    /** @legacy GET /reports/users */
    listPlayers: asyncHandler(async (req, res) => {
      const result = await service.listPlayers({ staff: req.staff, ...req.query });
      return response.paginated(res, result.rows, { ...page(req.query), total: result.total });
    }),

    /** @legacy GET /reports/user/:userId */
    playerReport: asyncHandler(async (req, res) =>
      response.ok(res, await service.playerReport({ staff: req.staff, ...req.params }))
    ),

    /**
     * @legacy GET /api/admin/agent-users
     *
     * `ok`, not `paginated`: the body carries two lists and the caller needs
     * both. The players page; the downline staff do not, because it is bounded
     * by the tree rather than by the customer count.
     */
    agentUsers: asyncHandler(async (req, res) => {
      const result = await service.agentUsers({ staff: req.staff, ...req.query });
      return response.ok(res, result, {
        pagination: { ...page(req.query), total: result.total },
      });
    }),

    /**
     * @legacy GET /reports/export
     *
     * A file, not an envelope — the browser saves it.
     */
    exportPlayers: asyncHandler(async (req, res) => {
      const result = await service.exportPlayers({ staff: req.staff, ...req.query });
      const stamp = new Date().toISOString().slice(0, 10);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', csv.filename('player_report', stamp));
      /**
       * Never render a downloaded CSV in the browser. Combined with the
       * download disposition this closes the case where a crafted cell is
       * interpreted as markup by a browser that decides to display the file.
       */
      res.setHeader('X-Content-Type-Options', 'nosniff');

      /**
       * A BOM, so Excel opens it as UTF-8.
       *
       * Without it Excel on Windows reads the file in the system codepage and
       * every non-ASCII player name is mojibake. Legacy sent no BOM and no
       * charset.
       */
      return res.status(200).send(`﻿${result.csv}`);
    }),

    /** @legacy GET /api/admin/user-risk/:userId */
    userRisk: asyncHandler(async (req, res) =>
      response.ok(res, await service.userRisk({ staff: req.staff, ...req.params }))
    ),

    staffRisk: asyncHandler(async (req, res) =>
      response.ok(res, await service.staffRisk({ staff: req.staff, ...req.params }))
    ),

    /** @legacy GET /api/admin/balance-sheet/:userId */
    balanceSheet: asyncHandler(async (req, res) => {
      const result = await service.balanceSheet({ staff: req.staff, ...req.params, ...req.query });
      return response.ok(res, result, {
        pagination: {
          page: Math.floor(req.query.offset / req.query.limit) + 1,
          limit: req.query.limit,
          total: result.total,
        },
      });
    }),

    /**
     * @legacy GET /api/report/player/:uid
     *
     * The one-click player PDF from the Users list.
     *
     * ─────────────────────────────────────────────────────────────────────
     * IT IS THE SAME DOCUMENT AS THE PLAYER STATEMENT NOW
     *
     * Legacy had a SECOND renderer for this — `reports/playerReportPdf.js` —
     * with its own queries and its own arithmetic. Its sports P&L was
     *
     *     result_status === 'win' ? (odds - 1) * stake : -stake
     *
     * computed from the bet rows, while the statement took the same figure
     * from `credits_ledger`. Those disagree on any bet that was voided,
     * partially settled or manually adjusted — so the platform could print two
     * different profit figures for the same player and period, and neither
     * document said which to believe.
     *
     * This builds the statement and renders it. There is one number.
     * ─────────────────────────────────────────────────────────────────────
     */
    playerSheet: asyncHandler(async (req, res) => {
      const statements = new StatementsService(deps);
      const statement = await statements.userStatement({
        staff: req.staff,
        userId: req.params.uid,
        from: req.query.from,
        to: req.query.to,
        // A printed sheet wants the rows, not a page of them.
        limit: 500,
        page: 1,
      });
      return renderStatement(res, statement);
    }),
  };
}

module.exports = { createControllers };
