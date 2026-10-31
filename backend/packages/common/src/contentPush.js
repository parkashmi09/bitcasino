'use strict';

/**
 * rainbet: "admin content changed" pushes, so the player site updates without a reload.
 *
 * `mountModules({ onAdminWrite })` calls the notifier after every successful staff write
 * (POST/PUT/PATCH/DELETE answered < 400) with `<service>:<module>`. Only modules whose data the
 * player site shows are passed on; the rest (KYC reviews, wallet adjustments, staff…) say
 * nothing. Writes within `delayMs` go out as one push.
 *
 * The push carries the scope names only — never data — and user-service emits it to every player
 * socket as `contentUpdated` `{ scopes }` (preferences/routes/internal.routes.js). The player site
 * re-reads what it has on screen.
 */

const CONTENT_SCOPES = Object.freeze(
  new Set([
    // admin-service
    'admin:banners',
    'admin:blogs',
    'admin:promotions',
    'admin:branding',
    'admin:vip-branding',
    'admin:site-content',
    'admin:original-games',
    // casino-service: catalogue, lobby categories / collections, providers, images, challenges
    'casino:games',
    'casino:catalogue',
    'casino:gis',
    'casino:challenges',
    'casino:original-games',
    // user-service
    'user:race',
    'user:raffle',
    'user:reload-rewards',
    'user:bonus',
    'user:spin-wheel',
  ])
);

/** `(scope) => void`, batching scopes into one `send(scopes)` call per `delayMs`. Never throws. */
function createContentNotifier({ send, logger, delayMs = 500 } = {}) {
  let pending = new Set();
  let timer = null;

  const flush = async () => {
    const scopes = [...pending];
    pending = new Set();
    timer = null;
    try {
      await send(scopes);
    } catch (error) {
      logger?.warn({ err: error?.message, scopes }, 'Content push failed');
    }
  };

  return (scope) => {
    if (!CONTENT_SCOPES.has(scope)) return;
    pending.add(scope);
    if (!timer) timer = setTimeout(flush, delayMs);
  };
}

module.exports = { CONTENT_SCOPES, createContentNotifier };
