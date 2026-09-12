'use strict';

const { FeedService } = require('./feed.service');
const { FeedClient } = require('./feedClient');

/**
 * Build the feed service, with its three provider clients.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A FACTORY AND NOT `new FeedService(deps)`
 *
 * `FeedService` needs a `feed` client. The container does not carry one — it is
 * constructed from config, because the cleartext check and the missing-key
 * check belong at construction rather than on the first request.
 *
 * The HTTP router built it inline. When the socket transport was added it did
 * `new FeedService(deps)` instead, so `this.feed` was `undefined` and
 * `C.SPORT_GAME` answered `SOCKET_HANDLER_FAILED` on a `TypeError` — reading
 * `.get` of undefined — while the identical HTTP route worked. The unit test
 * passed a stubbed feed, which is exactly the kind of gap a stub hides.
 *
 * One construction path, used by both transports. Cached per `deps` so the two
 * share one client, and therefore one response cache and one outbound rate
 * limiter — a second client would double the request rate to a provider that
 * limits us.
 * ═════════════════════════════════════════════════════════════════════════
 */
const SERVICES = new WeakMap();

function buildFeedService(deps) {
  if (SERVICES.has(deps)) return SERVICES.get(deps);

  const { models, logger, config } = deps;

  /**
   * `deps.feed` lets a test inject a client without a live provider — the same
   * escape hatch `gis.factory.js` gives with `deps.provider`. Production never
   * sets it, so the real path is the default rather than the special case.
   */
  const feed = deps.feed ?? new FeedClient({ config, logger });

  /**
   * The two secondary providers, if this deployment has them.
   *
   * Optional because only five endpoints need them, and a platform running on
   * the odds feed alone should still boot. `FeedClient` throws when the url or
   * key is missing, so the absence is caught here and reported as a 501 by the
   * service rather than at construction.
   */
  const optional = (provider) => {
    try {
      return new FeedClient({ config, logger, provider });
    } catch (error) {
      logger?.warn({ provider, reason: error.message }, 'Secondary sports provider not configured');
      return null;
    }
  };

  const service = new FeedService({
    models,
    feed,
    results: optional('results'),
    cache: deps.cache ?? null,
    logger,
    config,
    live: deps.live ?? optional('live'),
    media: deps.media ?? optional('media'),
  });

  SERVICES.set(deps, service);
  return service;
}

module.exports = { buildFeedService };
