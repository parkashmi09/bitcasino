'use strict';

const { Router } = require('express');
const { response, asyncHandler, entitlements, currencyRegistry, clearVipBranding } = require('@ibitplay/common');
const { LITERAL_EVENTS, PLATFORM_EVENTS, encode, roomForUser } = require('@ibitplay/socket');
const { invalidateSiteState } = require('../../sync/sockets');

/**
 * Site-wide pushes that another service asks for.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THE WRITE IS THERE AND THE EMIT IS HERE
 *
 * `siteconfig` and `site_features` are admin-service's tables, written from
 * the operator's Features screen. The clients that must hear about it are
 * players, and every player socket is on THIS service — there is no cross-
 * process Socket.IO adapter, so an `io.emit` from admin-service reaches
 * nobody. Admin-service therefore calls this route with the public view it
 * already computed, and this handler emits it to everyone connected.
 *
 * The body is the PUBLIC view, computed by the owner of the data: the same
 * allow-list `GET /admin/site-config/public` and `GET /admin/features/public`
 * serve. Nothing here reads the row, so nothing here can leak a column the
 * allow-list does not name.
 *
 * Internal audience: `x-internal-key` plus a caller the ACL admits
 * (`admin-service` only — see packages/common/src/internalAcl.js).
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function internalRoutes(deps) {
  const router = Router();

  /**
   * `POST /internal/user/preferences/site-config`
   *
   *   { flags?: object, features?: array, currencies?: array }
   *
   * Any part may be absent; each present part is one broadcast. `currencies`
   * is the public coin list (`GET /admin/currencies/public`).
   */
  router.post(
    '/site-config',
    asyncHandler(async (req, res) => {
      const { flags, features, currencies, content } = req.body ?? {};
      // A push follows every owner entitlement change too: re-read the plan on
      // the next player request instead of serving the cached copy for its TTL.
      entitlements.invalidateEntitlements();
      // …and the coin registry (names, networks, switches) likewise.
      if (currencies) currencyRegistry.invalidateCurrencyRegistry();
      // …and the sockets' shared site state, so the re-sync each push triggers is already new.
      invalidateSiteState();
      const io = deps.io;
      if (!io) return response.ok(res, { pushed: [], reason: 'socket transport not attached' });

      const pushed = [];
      if (flags && typeof flags === 'object' && !Array.isArray(flags)) {
        io.emit(LITERAL_EVENTS.SITE_CONFIG_UPDATED, encode(flags));
        pushed.push(LITERAL_EVENTS.SITE_CONFIG_UPDATED);
      }
      if (Array.isArray(features)) {
        io.emit(PLATFORM_EVENTS.FEATURES_UPDATED, encode(features));
        pushed.push(PLATFORM_EVENTS.FEATURES_UPDATED);
      }
      if (Array.isArray(currencies)) {
        io.emit(PLATFORM_EVENTS.CURRENCIES_UPDATED, encode(currencies));
        pushed.push(PLATFORM_EVENTS.CURRENCIES_UPDATED);
      }

      // rainbet: content scopes (names only, allow-listed by the sender; see contentPush.js).
      if (Array.isArray(content) && content.length) {
        const scopes = content.filter((s) => typeof s === 'string' && s.length <= 60).slice(0, 50);
        // This process caches the ladder names (10 s): drop it so the refetch the push triggers is fresh.
        if (scopes.includes('admin:vip-branding')) clearVipBranding();
        io.emit(PLATFORM_EVENTS.CONTENT_UPDATED, encode({ scopes }));
        pushed.push(PLATFORM_EVENTS.CONTENT_UPDATED);
      }

      deps.logger?.info({ pushed, caller: req.internalCaller ?? null, clients: io.engine?.clientsCount ?? null }, 'Site config pushed to every socket');
      return response.ok(res, { pushed, clients: io.engine?.clientsCount ?? null });
    })
  );

  /**
   * `POST /internal/user/preferences/inbox` `{ userIds }`: an admin notification was recorded for
   * these players. Each one's socket room gets `notificationsUnread`, and the bell re-reads its inbox.
   */
  router.post(
    '/inbox',
    asyncHandler(async (req, res) => {
      const ids = Array.isArray(req.body?.userIds) ? req.body.userIds.slice(0, 5000).map(String) : [];
      const io = deps.io;
      if (io) for (const id of ids) io.to(roomForUser(id)).emit(PLATFORM_EVENTS.NOTIFICATIONS_UNREAD, encode({ status: true }));
      return response.ok(res, { pushed: io ? ids.length : 0 });
    })
  );

  return router;
};
