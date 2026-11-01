'use strict';

const { Router } = require('express');
const { z, validate, response, asyncHandler, AppError, hubLink, whitelabelReport } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds, createSecretBox } = require('@ibitplay/auth');

const { WhitelabelLinkService } = require('../../whitelabel-link/whitelabelLink.service');

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const period = {
  query: z
    .object({ from: isoDate, to: isoDate })
    .strict()
    .refine((q) => Date.parse(q.from) < Date.parse(q.to) && Date.parse(q.to) - Date.parse(q.from) <= 731 * 86_400_000, 'from must be before to, at most 731 days'),
};

module.exports = function adminRoutes(deps) {
  const { auth, config, logger } = deps;
  const router = Router();

  const companyOnly = (req, _res, next) => {
    if (!config.WHITELABEL_MODE) return next(new AppError('Only a whitelabel has a revenue-share statement', 404, 'NOT_FOUND'));
    if (!canIssueFunds(req.staff)) return next(new AppError('Only the company can see its revenue-share statement', 403, 'COMPANY_ONLY'));
    return next();
  };
  const guard = [auth.requirePermission(PERMISSIONS.REPORTS_READ), companyOnly];

  async function statement({ from, to }) {
    const box = createSecretBox({ config, logger });
    const parent = await hubLink.callParent({ ...deps, box }, 'GET', `/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    let sports = null;
    let sportsError = null;
    if (!parent.products || parent.products.sports) {
      try {
        const own = await new WhitelabelLinkService(deps).sportsGgr({ from, to });
        if (String(own.currency).toUpperCase() === 'INR') sports = own;
        else sportsError = `this site reports in ${own.currency}, not INR`;
      } catch (error) {
        sportsError = error.message;
      }
    }
    return whitelabelReport.assemble({ from, to, ledger: parent.ledger, sports, sportsError, revenueShare: parent.revenueShare, products: parent.products });
  }

  router.get('/', ...guard, validate(period), asyncHandler(async (req, res) => response.ok(res, await statement(req.query))));
  router.get(
    '/csv',
    ...guard,
    validate(period),
    asyncHandler(async (req, res) => {
      const report = await statement(req.query);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="revenue-share-${req.query.from.slice(0, 10)}-${req.query.to.slice(0, 10)}.csv"`);
      return res.send(`﻿${whitelabelReport.toCsv(report, { name: 'this site' })}`);
    })
  );

  return router;
};
