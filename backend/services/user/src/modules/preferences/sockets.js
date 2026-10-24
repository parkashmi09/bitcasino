'use strict';

const { LITERAL_EVENTS, PLATFORM_EVENTS, AUDIENCE, encode } = require('@ibitplay/socket');

const { PreferencesService } = require('./preferences.service');

/**
 * Player settings, over the socket.
 *
 * See `preferences.service.js` for what `identify` and `subscribeUserConfig`
 * did — in short, both took a player id straight from the message, so either
 * one subscribed you to any player's config pushes and `identify` handed you
 * their settings on the spot.
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

/** The room a player's config pushes go to. Legacy's `ROOM.u`. */
const roomFor = (userId) => `room:user:${userId}`;

function register({ on, deps }) {
  const service = new PreferencesService(deps);
  const { logger } = deps;

  /**
   * @legacy SOCKET identify
   *
   * ── THE UID PARAMETER IS GONE ────────────────────────────────────────
   *
   * That parameter WAS the vulnerability. `identify(7)` made you player 7 for
   * the life of the connection — their config returned immediately, their room
   * joined, every later push delivered to you.
   *
   * The connection already knows who it is, from a verified token. So this
   * event still exists, still joins the room, still emits `userConfigUpdated`
   * — shipped clients depend on all three — and simply has nothing to say
   * about WHICH player.
   */
  on(LITERAL_EVENTS.IDENTIFY, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 30 },
    handle: async (_payload, context) => {
      const config = await service.get({ userId: context.userId });

      context.socket.join(roomFor(context.userId));
      // The event shipped clients listen on, alongside the ack.
      context.socket.emit(LITERAL_EVENTS.USER_CONFIG_UPDATED, encode(config));

      return ok({ config });
    },
  });

  /**
   * @legacy SOCKET subscribeUserConfig
   *
   *     socket.on('subscribeUserConfig', id => socket.join(ROOM.u(id)));
   *
   * One line. No check, no reply, no limit. A comment above it calls it an
   * "admin preview", which is what it is for — and nothing about it was
   * limited to an admin, so any client could subscribe to any player's config
   * pushes and simply listen.
   *
   * `AUDIENCE.STAFF` is the whole fix: it is genuinely an operator feature,
   * and it now requires an operator. The staff identity is resolved by the
   * transport against `GET /internal/admin/auth/verify`.
   */
  on(LITERAL_EVENTS.SUBSCRIBE_USER_CONFIG, {
    audience: AUDIENCE.STAFF,
    limit: { windowMs: 60_000, max: 60 },
    handle: async (payload, context) => {
      const target = payload?.uid ?? payload?.id ?? payload;
      const userId = Number(target);

      if (!Number.isInteger(userId) || userId <= 0) {
        return { status: false, msg: 'A player id is required' };
      }

      const config = await service.get({ userId });

      context.socket.join(roomFor(userId));
      context.socket.emit(LITERAL_EVENTS.USER_CONFIG_UPDATED, encode(config));

      logger?.info(
        { staffId: context.staff?.id, userId: String(userId) },
        'Operator subscribed to a player’s config'
      );

      return ok({ config });
    },
  });

  /**
   * The site's public config, loaded over the socket.
   *
   * ── WHY A CALL TO ADMIN-SERVICE ──────────────────────────────────────
   *
   * `siteconfig` and `site_features` are admin-service's tables and this
   * service does not load the `admin` model domain, so the snapshot comes
   * from `GET /internal/admin/site-config/public` — the same allow-lists the
   * two public HTTP routes serve, computed by the owner of the data.
   *
   * The ack carries `{ flags, features }`, and the same two halves are
   * emitted on `siteConfigUpdated` / `featuresUpdated` to this socket only, so
   * a client that listens for pushes is filled by the first call as well as
   * every later change. PUBLIC: a signed-out visitor draws the same page.
   */
  on(PLATFORM_EVENTS.GET_SITE_CONFIG, {
    audience: AUDIENCE.PUBLIC,
    limit: { windowMs: 60_000, max: 30 },
    handle: async (_payload, context) => {
      let snapshot;
      try {
        const result = await deps.clients.admin.get('/internal/admin/site-config/public');
        snapshot = result?.flags ? result : result?.data;
      } catch (error) {
        logger?.warn({ err: error.message }, 'Could not read the site config for a socket');
        return { status: false, msg: 'Site config is unavailable', error: { code: 'SITE_CONFIG_UNAVAILABLE' } };
      }

      const flags = snapshot?.flags ?? {};
      const features = Array.isArray(snapshot?.features) ? snapshot.features : [];

      context.socket.emit(LITERAL_EVENTS.SITE_CONFIG_UPDATED, encode(flags));
      context.socket.emit(PLATFORM_EVENTS.FEATURES_UPDATED, encode(features));

      return ok({ flags, features });
    },
  });
}

module.exports = { register, roomFor };
