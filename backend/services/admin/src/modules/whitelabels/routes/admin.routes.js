'use strict';

const { Router } = require('express');
const { validate, noBody, response, asyncHandler, createActivityRecorder, sitePolicy, whitelabelReport } = require('@ibitplay/common');
const { PERMISSIONS, canIssueFunds } = require('@ibitplay/auth');

const v = require('../whitelabels.validators');
const errors = require('../whitelabels.errors');
const { WhitelabelsService } = require('../whitelabels.service');

/**
 * Whitelabels — the Super Admin's side (and its executives, by their grants).
 *
 *   GET    /admin/whitelabels                        list ?search&status&limit&offset
 *   POST   /admin/whitelabels                        create → queued for the setup script
 *   GET    /admin/whitelabels/:id                    row + jobs + transfers + the copy's summary
 *   GET    /admin/whitelabels/:id/logo               its logo (…/icon: its square icon)
 *   PUT    /admin/whitelabels/:id/branding           { logo?, icon? } (base64) — also on the live copy
 *   PUT    /admin/whitelabels/:id/poster             { desktop?, mobile? } (base64) — the home-page poster
 *   GET    /admin/whitelabels/:id/poster/:which      poster | poster_mobile
 *   POST   /admin/whitelabels/:id/transfers          { amount, note?, transactionPassword } Direct → company Direct
 *   POST   /admin/whitelabels/:id/transfers/retry    send every pending transfer again
 *   PUT    /admin/whitelabels/:id/company-password   { password } (company signed out)
 *   PUT    /admin/whitelabels/:id/maintenance        { on }  off = maintenance on the copy
 *   PUT    /admin/whitelabels/:id/palette            { palette | null }
 *   PUT    /admin/whitelabels/:id/plan               { plan } products, features, payments
 *   PUT    /admin/whitelabels/:id/terms              { terms } gateway charges + GGR revenue share (parent only)
 *   POST   /admin/whitelabels/:id/hub-key            new API key + secret for its hub link (gateway payments)
 *   GET    /admin/whitelabels/report[.csv]           revenue-share statements, every whitelabel ?from&to
 *   GET    /admin/whitelabels/:id/report[.csv]       one whitelabel's statement ?from&to
 *   POST   /admin/whitelabels/:id/preview            → { url } one-time, read-only
 *   POST   /admin/whitelabels/:id/retry-setup        a failed setup, queued again
 *   DELETE /admin/whitelabels/:id                    { confirmName, acknowledgeBalances? }
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = deps.whitelabelsService ?? new WhitelabelsService(deps);
  const router = Router();
  const withActivity = createActivityRecorder({ client: clients.admin, logger, serviceName: config.SERVICE_NAME });

  const ownerOnly = asyncHandler(async (req, _res, next) => {
    if (config.WHITELABEL_MODE) throw errors.NOT_ON_A_COPY();
    if (!canIssueFunds(req.staff)) throw errors.OWNER_ONLY();
    // The owner's switch (owner panel → Features & plan → Whitelabel).
    if ((await sitePolicy.readPolicy(deps.models, 'whitelabel')) !== 'on') throw errors.DISABLED();
    next();
  });
  const canRead = [auth.requirePermission(PERMISSIONS.REPORTS_READ), ownerOnly];
  const canWrite = [auth.requirePermission(PERMISSIONS.STAFF_WRITE), ownerOnly];
  const canMoveMoney = [auth.requirePermission(PERMISSIONS.WALLET_ADJUST), ownerOnly];
  const audited = (action) =>
    withActivity({
      action,
      describe: (req) => ({
        targetType: 'WHITELABEL',
        targetId: req.params.id ?? null,
        // Never a password, the transaction password or the logo bytes.
        details: {
          fields: Object.keys(req.body ?? {}).filter((k) => !/password|logo/i.test(k)),
          ...(req.body?.amount ? { amount: req.body.amount } : {}),
          ...(typeof req.body?.on === 'boolean' ? { on: req.body.on } : {}),
          ...(req.body?.slug ? { slug: req.body.slug } : {}),
        },
      }),
    });
  const id = (req) => Number(req.params.id);

  router.get(
    '/',
    canRead,
    validate(v.list),
    asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.list(req.query);
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  router.post('/', canWrite, validate(v.create), audited('whitelabel.create'), asyncHandler(async (req, res) => response.created(res, await service.create(req.body, req.staff))));

  // Revenue share (reported, not collected): every whitelabel, or one; JSON or CSV. Before `/:id`.
  const csv = (res, name, body) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    return res.send(`\uFEFF${body}`);
  };
  router.get('/report', canRead, validate(v.reportAll), asyncHandler(async (req, res) => response.ok(res, await service.reportAll(req.query))));
  router.get(
    '/report.csv',
    canRead,
    validate(v.reportAll),
    asyncHandler(async (req, res) => {
      const all = await service.reportAll(req.query);
      const body = all.whitelabels.map((w) => whitelabelReport.toCsv(w, { name: `${w.name} (${w.slug})` })).join('\r\n\r\n');
      return csv(res, `whitelabels-revenue-share-${req.query.from.slice(0, 10)}-${req.query.to.slice(0, 10)}.csv`, body);
    })
  );
  router.get('/:id/report', canRead, validate(v.report), asyncHandler(async (req, res) => response.ok(res, await service.report(id(req), req.query))));
  router.get(
    '/:id/report.csv',
    canRead,
    validate(v.report),
    asyncHandler(async (req, res) => {
      const report = await service.report(id(req), req.query);
      return csv(res, `whitelabel-${id(req)}-revenue-share-${req.query.from.slice(0, 10)}-${req.query.to.slice(0, 10)}.csv`, whitelabelReport.toCsv(report, { name: `${report.name} (${report.slug})` }));
    })
  );

  router.get('/:id', canRead, validate(v.byId), asyncHandler(async (req, res) => response.ok(res, await service.detail(id(req)))));

  const sendImage = (which) =>
    asyncHandler(async (req, res) => {
      const logo = which === 'poster' ? await service.posterImage(id(req), req.params.which) : await service.image(id(req), which);
      res.set({
        'Content-Type': logo.contentType,
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
        // An SVG opened on its own is still an inert picture: no script, no fetches (as branding).
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      });
      return res.status(200).end(logo.data);
    });
  router.get('/:id/logo', canRead, validate(v.byId), sendImage('logo'));
  router.get('/:id/icon', canRead, validate(v.byId), sendImage('icon'));
  router.get('/:id/poster/:which', canRead, validate(v.posterImage), sendImage('poster'));
  router.put('/:id/poster', canWrite, validate(v.poster), audited('whitelabel.poster'), asyncHandler(async (req, res) => response.ok(res, await service.setPoster(id(req), req.body))));
  router.put('/:id/branding', canWrite, validate(v.branding), audited('whitelabel.branding'), asyncHandler(async (req, res) => response.ok(res, await service.setBranding(id(req), req.body))));

  router.post(
    '/:id/transfers',
    canMoveMoney,
    validate(v.transfer),
    audited('whitelabel.transfer'),
    asyncHandler(async (req, res) => response.created(res, await service.transfer({ ...req.body, id: id(req), actor: req.staff })))
  );
  router.post('/:id/transfers/retry', canMoveMoney, validate(v.byId), noBody(), asyncHandler(async (req, res) => response.ok(res, await service.retryTransfers(id(req)))));

  router.put(
    '/:id/company-password',
    canWrite,
    validate(v.password),
    audited('whitelabel.company-password'),
    asyncHandler(async (req, res) => response.ok(res, await service.setCompanyPassword(id(req), req.body.password)))
  );
  router.put('/:id/maintenance', canWrite, validate(v.maintenance), audited('whitelabel.maintenance'), asyncHandler(async (req, res) => response.ok(res, await service.setMaintenance(id(req), req.body.on))));
  router.put('/:id/palette', canWrite, validate(v.palette), audited('whitelabel.palette'), asyncHandler(async (req, res) => response.ok(res, await service.setPalette(id(req), req.body.palette))));
  router.put('/:id/plan', canWrite, validate(v.plan), audited('whitelabel.plan'), asyncHandler(async (req, res) => response.ok(res, await service.setPlan(id(req), req.body.plan))));
  router.put('/:id/terms', canMoveMoney, validate(v.terms), audited('whitelabel.terms'), asyncHandler(async (req, res) => response.ok(res, await service.setTerms(id(req), req.body.terms))));
  router.post('/:id/hub-key', canMoveMoney, validate(v.byId), noBody(), audited('whitelabel.hub-key'), asyncHandler(async (req, res) => response.ok(res, await service.issueHubKey(id(req)))));
  router.post('/:id/preview', canRead, validate(v.byId), noBody(), asyncHandler(async (req, res) => response.ok(res, await service.preview(id(req)))));
  router.post('/:id/retry-setup', canWrite, validate(v.byId), noBody(), audited('whitelabel.retry-setup'), asyncHandler(async (req, res) => response.ok(res, await service.retrySetup(id(req), req.staff))));
  router.delete(
    '/:id',
    canWrite,
    validate(v.remove),
    audited('whitelabel.delete'),
    asyncHandler(async (req, res) => response.ok(res, await service.remove({ ...req.body, id: id(req), actor: req.staff })))
  );

  return router;
};
