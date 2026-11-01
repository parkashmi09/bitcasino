'use strict';

const { Router } = require('express');
const { z, validate, noQuery, response, asyncHandler, AppError, whitelabelReport } = require('@ibitplay/common');

const { authenticateCopy, requireParent } = require('../hubCredentials');
const hubOrders = require('../hubOrders');
const { PaymentOrdersService } = require('../../payment-orders/paymentOrders.service');
const { PspService } = require('../../psp/psp.service');

const provider = z.string().regex(/^[a-z0-9]{2,20}$/);
const reference = z.string().regex(/^[A-Za-z0-9_:-]{4,64}$/);
const amount = z.string().regex(/^\d+(\.\d{1,8})?$/, 'a positive decimal amount');
const currency = z.string().regex(/^[A-Za-z0-9]{2,10}$/);
const percent = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/);
const customer = z.object({ name: z.string().max(120).nullish(), email: z.string().max(190).nullish(), phone: z.string().max(40).nullish() }).strict().nullish();

const schemas = {
  deposit: {
    body: z
      .object({
        provider,
        copyReference: reference,
        userId: z.string().regex(/^\d{1,20}$/),
        currency,
        amount,
        method: z.string().max(60).optional(),
        chain: z.string().max(40).optional(),
        returnUrl: z.string().url().max(500).optional(),
        customer,
        ip: z.string().max(64).optional(),
      })
      .strict(),
  },
  payout: {
    body: z
      .object({
        provider,
        copyReference: reference,
        userId: z.string().regex(/^\d{1,20}$/),
        currency,
        amount,
        method: z.string().max(60),
        details: z.record(z.string(), z.unknown()),
        customer,
        chargePct: percent,
      })
      .strict(),
  },
  order: { query: z.object({ flow: z.enum(['deposit', 'payout']), copyReference: reference }).strict() },
  // A statement period: ISO dates, `to` exclusive, at most two years.
  report: {
    query: z
      .object({ from: z.string().datetime({ offset: true }).or(z.string().date()), to: z.string().datetime({ offset: true }).or(z.string().date()) })
      .strict()
      .refine((q) => Date.parse(q.from) < Date.parse(q.to) && Date.parse(q.to) - Date.parse(q.from) <= 731 * 86_400_000, 'from must be before to, at most 731 days'),
  },
  event: {
    body: z
      .object({
        provider,
        flow: z.enum(['deposit', 'payout']),
        reference,
        parentReference: reference,
        status: z.enum(['success', 'failed']),
        amount,
        currency,
        chargePct: z.string().regex(/^\d{1,3}(\.\d{1,8})?$/),
        // A bank UTR, or an on-chain transaction hash (CCPayment).
        utr: z.string().max(128).optional(),
      })
      .strict(),
  },
};

module.exports = publicRoutes;
// The copy's hubGateway and the parent's delivery send these shapes (tests run bodies through them).
module.exports.schemas = schemas;

function publicRoutes(deps) {
  const router = Router();
  const orders = () => new PaymentOrdersService(deps);

  // ── Parent: a copy calls in ─────────────────────────────────────────
  const copy = authenticateCopy(deps);

  router.get(
    '/payments/terms',
    copy,
    noQuery(),
    asyncHandler(async (req, res) => {
      const { plan, terms } = req.whitelabel;
      const fees = Object.fromEntries(Object.entries(terms.fees).filter(([g]) => plan?.payments.gateways[g]));
      return response.ok(res, { fees });
    })
  );
  router.post(
    '/payments/deposit',
    copy,
    validate(schemas.deposit),
    asyncHandler(async (req, res) => response.ok(res, await orders().hubDeposit({ whitelabel: req.whitelabel, ...req.body })))
  );
  router.post(
    '/payments/payout',
    copy,
    validate(schemas.payout),
    asyncHandler(async (req, res) => response.ok(res, await orders().hubPayout({ whitelabel: req.whitelabel, ...req.body })))
  );
  router.get(
    '/payments/order',
    copy,
    validate(schemas.order),
    asyncHandler(async (req, res) => {
      const order = await hubOrders.byCopyReference(deps.db, req.whitelabel.id, req.query.flow, req.query.copyReference);
      if (!order) throw new AppError('No such order', 404, 'HUB_ORDER_NOT_FOUND');
      return response.ok(res, order);
    })
  );

  /**
   * The copy's own revenue-share statement, parent's half: casino, original games, gateway and
   * transfers from this site's records, and the share rates. The copy adds its sports figure and
   * assembles the statement with the same code (common/whitelabelReport), so both sides agree.
   */
  router.get(
    '/report',
    copy,
    validate(schemas.report),
    asyncHandler(async (req, res) => {
      const { from, to } = req.query;
      const ledger = await whitelabelReport.ledgerFigures(deps.db, { whitelabelId: req.whitelabel.id, from, to });
      return response.ok(res, { ledger, revenueShare: req.whitelabel.terms.revenueShare, products: req.whitelabel.plan?.products ?? null });
    })
  );

  // ── Copy: the parent reports an outcome ─────────────────────────────
  router.post(
    '/in/payments',
    (req, _res, next) => next(deps.config.WHITELABEL_MODE ? undefined : new AppError('Not found', 404, 'NOT_FOUND')),
    requireParent(deps),
    validate(schemas.event),
    asyncHandler(async (req, res) => response.ok(res, await new PspService(deps).applyHubEvent(req.body)))
  );

  return router;
}
