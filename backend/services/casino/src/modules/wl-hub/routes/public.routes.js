'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { z, validate, response, asyncHandler, AppError } = require('@ibitplay/common');

const { authenticateCopy, requireParent } = require('../hubCredentials');
const { buildGisService, providerFor } = require('../../gis/gis.factory');
const { buildOriginalGamesService } = require('../../original-games/originalGames.factory');

/** What a copy may ask Slotegrator through the parent. Freespins, vouchers and self-validate stay off. */
const ALLOWED = Object.freeze({
  POST: ['/games/init', '/games/init-demo'],
  GET: ['/games', '/games/lobby', '/limits', '/game-tags', '/jackpots'],
});

const schemas = {
  provider: {
    body: z
      .object({
        method: z.enum(['GET', 'POST']),
        path: z.string().max(40),
        params: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
  },
  ogProvider: {
    body: z
      .object({
        method: z.enum(['GET', 'POST']),
        path: z.string().max(40),
        body: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  },
  // The provider's own callback bodies (their field sets vary by action); the parent verified them.
  og: { body: z.object({ action: z.enum(['balance', 'bet', 'win', 'rollback']), body: z.object({ player_id: z.string().regex(/^\d{1,18}$/) }).passthrough() }).strict() },
  gis: { body: z.object({ action: z.string().max(20), player_id: z.string().regex(/^\d{1,20}$/) }).passthrough() },
};

module.exports = publicRoutes;
module.exports.schemas = schemas;
module.exports.ALLOWED = ALLOWED;

function publicRoutes(deps) {
  const router = Router();

  // ── Parent: a copy's Slotegrator call, on this site's account ─────────
  router.post(
    '/gis/provider',
    authenticateCopy(deps),
    validate(schemas.provider),
    asyncHandler(async (req, res) => {
      const { method, path } = req.body;
      if (!req.whitelabel.plan?.products.casino) throw new AppError('Casino is not in this whitelabel’s plan', 403, 'NOT_ENTITLED');
      if (!ALLOWED[method].includes(path)) throw new AppError('Not available to a whitelabel', 403, 'HUB_NOT_ALLOWED', { method, path });
      const params = { ...req.body.params };
      if (path === '/games/init') {
        // The callbacks come back with this id: the parent writes the whitelabel into it, never the copy.
        if (!/^\d{1,20}$/.test(String(params.player_id ?? ''))) throw new AppError('player_id must be the copy’s player id', 422, 'VALIDATION_ERROR');
        params.player_id = `wl${req.whitelabel.id}_${params.player_id}`;
      }
      const provider = providerFor(deps);
      if (!provider.configured) throw new AppError('Slotegrator is not configured on the parent site', 503, 'GIS_NOT_CONFIGURED');
      try {
        return response.ok(res, method === 'GET' ? await provider.get(path, params) : await provider.post(path, params));
      } catch (error) {
        deps.logger?.error({ err: error.message, status: error.status, path, whitelabelId: req.whitelabel.id }, 'Slotegrator call for a whitelabel failed');
        if (error.status >= 400 && error.status < 500) throw new AppError('Slotegrator refused the request', 422, 'GIS_UPSTREAM_REJECTED', { status: error.status });
        throw new AppError('Slotegrator did not answer', 502, 'GIS_UPSTREAM_FAILED');
      }
    })
  );

  // ── Parent: a copy's original-games call, on this site's account ──────
  router.post(
    '/og/provider',
    authenticateCopy(deps),
    validate(schemas.ogProvider),
    asyncHandler(async (req, res) => {
      const { method, path } = req.body;
      if (!req.whitelabel.plan?.products.originals) throw new AppError('Original games are not in this whitelabel’s plan', 403, 'NOT_ENTITLED');
      const launch = method === 'POST' && path === '/v1/sessions/launch';
      if (!launch && !(method === 'GET' && path === '/v1/games')) throw new AppError('Not available to a whitelabel', 403, 'HUB_NOT_ALLOWED', { method, path });
      const service = buildOriginalGamesService(deps);
      if (!service.provider?.configured) throw new AppError('Original games are not configured on the parent site', 503, 'OG_NOT_CONFIGURED');
      let body;
      if (launch) {
        const player = { ...(req.body.body?.player ?? {}) };
        if (!/^\d{1,18}$/.test(String(player.id ?? ''))) throw new AppError('player.id must be the copy’s player id', 422, 'VALIDATION_ERROR');
        player.id = `wl${req.whitelabel.id}_${player.id}`;
        // The parent's credentials decide real or demo, not the copy's (it has none).
        body = { ...req.body.body, player, mode: service.mode };
      }
      try {
        return response.ok(res, await service.provider.request(method, path, { body, idempotencyKey: launch ? crypto.randomUUID() : undefined }));
      } catch (error) {
        deps.logger?.error({ err: error.message, status: error.status, path, whitelabelId: req.whitelabel.id }, 'Original-games call for a whitelabel failed');
        if (error.status >= 400 && error.status < 500) throw new AppError('The original-games provider refused the request', 422, error.code ?? 'OG_UPSTREAM_REJECTED');
        throw new AppError('The original-games provider did not answer', 502, 'OG_UPSTREAM_FAILED');
      }
    })
  );

  // ── Copy: the parent passes on a verified original-games callback ─────
  router.post(
    '/in/og',
    requireParent(deps),
    validate(schemas.og),
    asyncHandler(async (req, res) => response.ok(res, await buildOriginalGamesService(deps).callback(req.body.action, { body: req.body.body, trusted: true })))
  );

  // ── Copy: the parent passes on a verified Slotegrator callback ────────
  router.post(
    '/in/gis',
    requireParent(deps),
    validate(schemas.gis),
    asyncHandler(async (req, res) => response.ok(res, await buildGisService(deps).handleTransaction({ body: req.body, trusted: true })))
  );

  return router;
}
