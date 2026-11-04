'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { z, validate, noBody, response, asyncHandler, createRateLimiter, UnauthorizedError, whitelabelPlan } = require('@ibitplay/common');

const { WhitelabelLinkService, PALETTE_KEYS } = require('../whitelabelLink.service');
const { brandingStore } = require('../../branding/branding.store');
const { BannersService } = require('../../banners/banners.service');

/** Constant-time, like the owner key (modules/owner). Unset secret = never matches. */
function keyMatches(given, secret) {
  if (!secret || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

const amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a positive amount with at most 2 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

/** Every plan key a boolean; at least one product, and manual payments or a gateway. Shared with the parent's validators. */
function planSchema() {
  const bools = (keys) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()]))).strict();
  return z
    .object({
      products: bools(whitelabelPlan.PRODUCTS),
      features: bools(whitelabelPlan.FEATURES),
      payments: z.object({ manual: z.boolean(), gateways: bools(whitelabelPlan.GATEWAYS) }).strict(),
    })
    .strict()
    .refine((p) => Object.values(p.products).some(Boolean), 'choose at least one product: casino, sports or original games')
    .refine((p) => p.payments.manual || Object.values(p.payments.gateways).some(Boolean), 'choose manual payments, a payment gateway or both');
}

const schemas = {
  redeem: { body: z.object({ code: z.string().min(16).max(64) }).strict() },
  credit: {
    body: z
      .object({
        transferId: z.string().trim().regex(/^[A-Za-z0-9:_-]{1,64}$/),
        amount,
        note: z.string().trim().max(200).optional(),
      })
      .strict(),
  },
  password: { body: z.object({ password: z.string().min(8).max(200) }).strict() },
  maintenance: { body: z.object({ on: z.boolean() }).strict() },
  // The home-page poster: banner placements `home` / `home_mobile` (the player site's hero art).
  poster: {
    body: z
      .object({ placement: z.enum(['home', 'home_mobile']), type: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().min(1).max(820_000) })
      .strict(),
  },
  // The logo or the square mark (favicon), base64; the branding store checks the bytes.
  branding: {
    body: z
      .object({ slot: z.enum(['logo', 'mark']), type: z.enum(['image/png', 'image/webp', 'image/svg+xml']), data: z.string().min(1).max(360_000) })
      .strict(),
  },
  // Products and features the parent sold this copy; at least one product.
  plan: { body: z.object({ plan: planSchema() }).strict() },
  // The hub link: the parent's user-service URL here, this copy's key and secret (common/hubAuth).
  hub: {
    body: z
      .object({
        url: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{2,5}$/, 'the parent user-service on this machine'),
        casinoUrl: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{2,5}$/, 'the parent casino-service on this machine').optional(),
        key: z.string().regex(/^wlk_[0-9a-f]{24}$/),
        secret: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
  },
  // A statement period: two ISO dates, at most two years apart.
  ggr: {
    query: z
      .object({ from: z.string().datetime({ offset: true }).or(z.string().date()), to: z.string().datetime({ offset: true }).or(z.string().date()) })
      .strict()
      .refine((q) => Date.parse(q.from) < Date.parse(q.to) && Date.parse(q.to) - Date.parse(q.from) <= 731 * 86_400_000, 'from must be before to, at most 731 days'),
  },
  // Every token, as #RRGGBB; null clears it.
  palette: {
    body: z
      .object({
        palette: z
          .object(Object.fromEntries(PALETTE_KEYS.map((k) => [k, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB')])))
          .strict()
          .nullable(),
      })
      .strict(),
  },
};

module.exports = publicRoutes;
// The parent's tests send every link body through these, so the two sides cannot drift apart.
module.exports.schemas = schemas;
module.exports.planSchema = planSchema;

function publicRoutes(deps) {
  const router = Router();
  const service = deps.whitelabelLinkService ?? new WhitelabelLinkService(deps);
  const enabled = deps.config.RATE_LIMIT_ENABLED !== false;
  const redeemLimiter = createRateLimiter({ name: 'whitelabel:preview', windowMs: 60_000, max: 20, enabled });

  router.get(
    '/status',
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      return response.ok(res, await service.status());
    })
  );

  router.get(
    '/theme',
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      return response.ok(res, await service.theme());
    })
  );

  router.post(
    '/preview/redeem',
    redeemLimiter,
    validate(schemas.redeem),
    asyncHandler(async (req, res) => response.ok(res, await service.redeemPreview(req.body.code)))
  );

  // Everything below: the parent only.
  router.use((req, _res, next) => {
    const direct = !req.get('x-forwarded-for');
    next(direct && keyMatches(req.get('x-whitelabel-key'), deps.config.WHITELABEL_LINK_KEY) ? undefined : new UnauthorizedError('Bad whitelabel key'));
  });

  router.get('/summary', asyncHandler(async (_req, res) => response.ok(res, await service.summary())));
  router.post('/credit', validate(schemas.credit), asyncHandler(async (req, res) => response.ok(res, await service.credit(req.body))));
  router.post(
    '/company-password',
    validate(schemas.password),
    asyncHandler(async (req, res) => response.ok(res, await service.setCompanyPassword(req.body.password)))
  );
  router.put(
    '/branding',
    validate(schemas.branding),
    asyncHandler(async (req, res) => {
      const store = deps.brandingStore ?? brandingStore(deps);
      const ownerBranding = deps.entitlementsStore?.current()?.branding ?? null;
      return response.ok(res, await store.setSite(req.body.slot, Buffer.from(req.body.data, 'base64'), { staff: null, ownerBranding }));
    })
  );
  router.put(
    '/poster',
    validate(schemas.poster),
    asyncHandler(async (req, res) => {
      const banners = new BannersService(deps);
      const file = { buffer: Buffer.from(req.body.data, 'base64'), originalname: `${req.body.placement}.img`, mimetype: req.body.type };
      return response.ok(res, await banners.putBanner({ staff: null, type: req.body.placement, file }));
    })
  );
  router.get('/plan', asyncHandler(async (_req, res) => response.ok(res, await service.plan())));
  router.put(
    '/plan',
    validate(schemas.plan),
    asyncHandler(async (req, res) => {
      const out = await service.setPlan(req.body.plan);
      // Apply it now rather than at the next poll: entitlements, site_features and the player sockets.
      await deps.entitlementsStore?.load();
      return response.ok(res, out);
    })
  );
  router.get('/ggr', validate(schemas.ggr), asyncHandler(async (req, res) => response.ok(res, await service.sportsGgr(req.query))));
  router.put('/hub', validate(schemas.hub), asyncHandler(async (req, res) => response.ok(res, await service.setHub(req.body))));
  router.put('/palette', validate(schemas.palette), asyncHandler(async (req, res) => response.ok(res, await service.setPalette(req.body.palette))));
  router.put('/maintenance', validate(schemas.maintenance), asyncHandler(async (req, res) => response.ok(res, await service.setMaintenance(req.body.on))));
  router.post('/preview', noBody(), asyncHandler(async (_req, res) => response.ok(res, await service.preview())));

  return router;
}
