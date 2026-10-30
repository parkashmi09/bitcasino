'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { z, validate, noBody, response, asyncHandler, createRateLimiter, UnauthorizedError } = require('@ibitplay/common');

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
  router.put('/palette', validate(schemas.palette), asyncHandler(async (req, res) => response.ok(res, await service.setPalette(req.body.palette))));
  router.put('/maintenance', validate(schemas.maintenance), asyncHandler(async (req, res) => response.ok(res, await service.setMaintenance(req.body.on))));
  router.post('/preview', noBody(), asyncHandler(async (_req, res) => response.ok(res, await service.preview())));

  return router;
}
