'use strict';

const crypto = require('crypto');
const express = require('express');
const { Router } = require('express');
const { z, validate, response, asyncHandler, createRateLimiter, UnauthorizedError, ServiceUnavailableError, NotFoundError } = require('@ibitplay/common');

const { brandingStore } = require('../../branding/branding.store');
const { MAX_IMAGE_BYTES } = require('../../branding/branding.rules');

/**
 * The owner panel's API (docs/OWNER-PANEL.md §3). Header `x-owner-key: <OWNER_SHARED_SECRET>`,
 * compared in constant time; unset secret = every call 401, so a site without one is not
 * owner-managed. The key only lets a caller PROPOSE a document: a new version is stored only
 * when its signature verifies (the Ed25519 one when OWNER_VERIFY_KEY is set, which the key
 * cannot make) — entitlements.store.js `accept()`.
 *
 * No answer ever carries a secret: the stored document, its version and the audit entries.
 */
function keyMatches(given, secret) {
  if (!secret || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

const FILE = /^[0-9a-f]{64}\.(png|webp|svg)$/;
const emptyQuery = z.preprocess((v) => v ?? {}, z.object({}).strict());
const fileParams = z.object({ file: z.string().regex(FILE, 'not a branding image name') }).strict();

const saveBody = z
  .object({
    data: z.record(z.string(), z.unknown()),
    signature: z.string().max(128).optional(),
    signatureEd25519: z.string().max(200).optional(),
    // The owner panel's audit line for this version: { at, user, version, changes, seededFrom? }.
    audit: z.object({ at: z.string().max(40), version: z.number().int() }).passthrough().optional(),
    updatedBy: z.string().max(190).optional(),
  })
  .strict();

const auditQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    before: z.coerce.number().int().min(1).optional(),
  })
  .strict();

const uploadQuery = z.object({ slot: z.enum(['logo', 'mark', 'ogImage']) }).strict();

module.exports = function publicRoutes(deps) {
  const router = Router();
  const branding = deps.brandingStore ?? brandingStore(deps);
  const limiter = createRateLimiter({
    name: 'owner:api',
    windowMs: 60_000,
    max: 120,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  function ownerKey(req, _res, next) {
    next(keyMatches(req.get('x-owner-key'), deps.config?.OWNER_SHARED_SECRET) ? undefined : new UnauthorizedError('Bad owner key'));
  }

  function store() {
    if (!deps.entitlementsStore) throw new ServiceUnavailableError('Entitlements store not running');
    return deps.entitlementsStore;
  }

  router.use(limiter, ownerKey);

  /** `{ version, doc }` — the newest row as it was signed (`doc` null before the first save). */
  router.get(
    '/entitlements',
    validate({ query: emptyQuery }),
    asyncHandler(async (_req, res) => {
      const row = await store().latestRow();
      res.set('Cache-Control', 'no-store');
      return response.ok(res, { version: row?.version ?? 0, doc: row?.doc ?? null });
    })
  );

  /** A new signed version. 400 bad signature / stale, 409 not newer / other site; else applied and pushed. */
  router.put(
    '/entitlements',
    validate({ body: saveBody }),
    asyncHandler(async (req, res) => {
      const { data, signature, signatureEd25519, audit, updatedBy } = req.body;
      const current = await store().accept({ data, signature, signatureEd25519 }, { updatedBy, audit: audit?.version === data.version ? audit : null });
      return response.ok(res, { version: current.version, source: current.source });
    })
  );

  router.get(
    '/audit',
    validate({ query: auditQuery }),
    asyncHandler(async (req, res) => response.ok(res, await store().audit(req.query)))
  );

  /** Raw image bytes (`Content-Type: application/octet-stream`); stored by hash, served only once a document names it. */
  router.put(
    '/branding/asset/:file',
    express.raw({ type: () => true, limit: Math.max(...Object.values(MAX_IMAGE_BYTES)) + 1024 }),
    validate({ params: fileParams, query: uploadQuery }),
    asyncHandler(async (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      return response.ok(res, await branding.put(req.params.file, bytes, req.query.slot));
    })
  );

  router.get(
    '/branding/asset/:file',
    validate({ params: fileParams, query: emptyQuery }),
    asyncHandler(async (req, res) => {
      const image = await branding.stored(req.params.file);
      if (!image) throw new NotFoundError('No such branding image');
      res.set({ 'Content-Type': image.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
      return res.status(200).end(image.data);
    })
  );

  return router;
};
