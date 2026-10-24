'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../siteConfig.validators');
const { SiteConfigService } = require('../siteConfig.service');

/**
 * Platform settings, for staff.
 *
 * Legacy mounted the two affiliate settings routes on `/affiliateAdmin` with NO
 * middleware whatsoever. The PUT set the commission percentage and the
 * registration bonus — the two numbers that decide what the platform pays out —
 * from an unauthenticated request.
 *
 * The write is audited for the same reason it is permissioned: a settings
 * change here does not move money at the moment it happens, so the only record
 * that it was made, by whom, is this one. Every payment it later affects looks
 * ordinary.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new SiteConfigService(deps);

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  /** @legacy GET /affiliateAdmin/settings */
  router.get(
    '/affiliate',
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    asyncHandler(async (_req, res) => response.ok(res, await service.affiliateSettings()))
  );

  /** @legacy PUT /affiliateAdmin/settings */
  router.put(
    '/affiliate',
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate(v.updateAffiliateSettings),
    withActivity({
      action: 'site-config.affiliate.update',
      describe: (req) => ({ targetType: 'SITE_CONFIG', targetId: 'affiliate', details: req.body }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.updateAffiliateSettings({ ...req.body, staffId: req.staff?.id ?? null })
      )
    )
  );

  /** @legacy GET /sportsCheck */
  router.get(
    '/sports',
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    asyncHandler(async (_req, res) => response.ok(res, await service.sportsEnabled()))
  );

  /**
   * The platform-wide sports kill switch.
   *
   * Audited because it is the loudest configuration change there is: turning it
   * off takes every sports market off the board for every player at once.
   */
  router.put(
    '/sports',
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate(v.setSportsEnabled),
    withActivity({
      action: 'site-config.sports.toggle',
      describe: (req) => ({
        targetType: 'SITE_CONFIG', targetId: 'sports', details: { enabled: req.body.enabled },
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.setSportsEnabled({ enabled: req.body.enabled, staffId: req.staff?.id ?? null })
      )
    )
  );

  // ── Feature flags ───────────────────────────────────────────────────

  /** @legacy GET /api/admin/config/global */
  router.get(
    '/global',
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    asyncHandler(async (_req, res) => response.ok(res, await service.globalSettings()))
  );

  /**
   * @legacy PUT /api/admin/config/global
   *
   * Audited, and the audit names WHICH flags moved. Turning `casino` or
   * `sports` off takes a whole product off the site for every player at once,
   * and nothing else records that it happened.
   *
   * Legacy required a transaction password here. That is not carried over: the
   * password guards operations that MOVE MONEY, and diluting it across
   * settings screens is how it stops being a meaningful second factor. This is
   * `config:write` plus an audit row.
   */
  router.put(
    '/global',
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate(v.updateGlobalSettings),
    withActivity({
      action: 'site-config.global.update',
      describe: (req) => ({
        targetType: 'SITE_CONFIG', targetId: 'global', details: { flags: req.body },
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.updateGlobalSettings({ ...req.body, staffId: req.staff?.id ?? null })
      )
    )
  );

  // ── One player's preferences ────────────────────────────────────────

  /** @legacy GET /api/admin/config/user/:uid */
  router.get(
    '/user/:userId',
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    validate(v.userParam),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.userSettings({ actor: { id: req.staff.id }, userId: req.params.userId })
      )
    )
  );

  /** @legacy PUT /api/admin/config/user/:uid */
  router.put(
    '/user/:userId',
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate(v.updateUserSettings),
    withActivity({
      action: 'site-config.user.update',
      describe: (req) => ({
        targetType: 'USER', targetId: req.params.userId, details: { settings: req.body },
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.updateUserSettings({
          ...req.body,
          actor: { id: req.staff.id },
          userId: req.params.userId,
          staffId: req.staff?.id ?? null,
        })
      )
    )
  );

  // ── Outbound mail ───────────────────────────────────────────────────

  /** @legacy GET /email/settings */
  router.get(
    '/email',
    auth.requirePermission(PERMISSIONS.CONFIG_READ),
    asyncHandler(async (_req, res) => response.ok(res, await service.emailSettings()))
  );

  /**
   * @legacy PUT /email/settings
   *
   * Audited, and the audit records WHICH settings changed, never their values —
   * one of them is an SMTP credential.
   */
  router.put(
    '/email',
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    validate(v.updateEmailSettings),
    withActivity({
      action: 'site-config.email.update',
      describe: (req) => ({
        targetType: 'SITE_CONFIG',
        targetId: 'email',
        details: { changed: Object.keys(req.body) },
      }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(
        res,
        await service.updateEmailSettings({ ...req.body, staffId: req.staff?.id ?? null })
      )
    )
  );

  /** @legacy POST /email/settings/test */
  router.post(
    '/email/test',
    auth.requirePermission(PERMISSIONS.CONFIG_WRITE),
    withActivity({
      action: 'site-config.email.test',
      describe: () => ({ targetType: 'SITE_CONFIG', targetId: 'email' }),
    }),
    asyncHandler(async (req, res) =>
      response.ok(res, await service.sendTestEmail({ staffId: req.staff?.id ?? null }))
    )
  );

  return router;
};
