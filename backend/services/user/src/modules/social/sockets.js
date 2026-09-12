'use strict';

const { EVENTS, LITERAL_EVENTS, AUDIENCE, encode } = require('@ibitplay/socket');

const { SocialService } = require('./social.service');
const { MAX_MESSAGE_LENGTH } = require('./social.constants');

/**
 * Chat, friends and private messages, over the socket.
 *
 * See `index.js` for what the legacy versions did — in short, a chat message
 * was broadcast to every client before it was stored, there was no length
 * limit anywhere, and the "user not found" branch referenced an undefined
 * variable and threw.
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

function register({ on, deps }) {
  const service = new SocialService(deps);
  const { logger } = deps;

  /**
   * @legacy SOCKET 1e6ccf0ddced017179b173e5cc78beea
   *
   * `C.ADD_CHAT`.
   */
  on(EVENTS.ADD_CHAT, {
    audience: AUDIENCE.USER,
    // Legacy metered nothing, so one client could flood every connected
    // player. Twenty messages a minute is a conversation; more is a flood.
    limit: { windowMs: 60_000, max: 20 },
    handle: async (payload, context) => {
      const { country, room, message } = payload ?? {};
      try {
        const posted = await service.postChat({
          userId: context.userId,
          room: room ?? country,
          message,
        });

        /**
         * Broadcast AFTER the write returns. Legacy emitted first and inserted
         * second, so a failed insert still reached every client.
         *
         * `.broadcast` excludes this socket, and the sender gets the same
         * payload as their own reply — so nobody sees their message twice.
         */
        context.socket.broadcast.emit(EVENTS.ADD_CHAT, encode(ok(posted)));

        return ok(posted);
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 7a7fe97bbc5ff21a561b79986db975c5
   *
   * `C.CHATS` — reading a room.
   *
   * PUBLIC by declaration. Legacy's handler had no `if (!id) return;` — one of
   * only two in the file that omitted it — so this was public by oversight.
   * Reading a public room without signing in is defensible; the difference is
   * that it is now a decision somebody made.
   */
  on(EVENTS.CHATS, {
    audience: AUDIENCE.PUBLIC,
    handle: async (payload) => {
      const { country, room, limit } = payload ?? {};
      try {
        return ok(await service.listChat({ room: room ?? country, limit }));
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 265ea6ce905188a0751e8f0273d30bb7
   *
   * `C.ADD_FRIEND`.
   */
  on(EVENTS.ADD_FRIEND, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 30 },
    handle: async (payload, context) => {
      try {
        return ok(await service.addFriend({ userId: context.userId, name: payload?.name ?? payload?.username }));
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 1e73d7d857e371f00a56105a7a38a576
   *
   * `C.MY_FRIENDS`.
   */
  on(EVENTS.MY_FRIENDS, {
    audience: AUDIENCE.USER,
    handle: async (_payload, context) => {
      try {
        return ok(await service.listFriends({ userId: context.userId }));
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 292d72d37f7e189059f7f998737de9bb
   *
   * `C.ADD_MESSAGES` — send a private message.
   */
  on(EVENTS.ADD_MESSAGES, {
    audience: AUDIENCE.USER,
    limit: { windowMs: 60_000, max: 30 },
    handle: async (payload, context) => {
      const { to, name, message } = payload ?? {};
      try {
        const sent = await service.sendMessage({
          userId: context.userId,
          toName: to ?? name,
          message,
        });

        /**
         * Delivered to the recipient's own room, not broadcast. The connection
         * handler joins every signed-in socket to `user:<id>`, so a player with
         * two devices gets it on both.
         */
        context.socket.to(`user:${sent.to}`).emit(EVENTS.ADD_MESSAGES, encode(ok(sent)));

        return ok(sent);
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET de70938879b75d3db63bba721c93e018
   *
   * `C.MESSAGES` — read a conversation.
   *
   * The `room_key` is derived from the two ids rather than accepted from the
   * message, so a caller cannot ask for a thread they are not in.
   */
  on(EVENTS.MESSAGES, {
    audience: AUDIENCE.USER,
    handle: async (payload, context) => {
      const { with: withName, name, limit } = payload ?? {};
      try {
        return ok(await service.listMessages({ userId: context.userId, withName: withName ?? name, limit }));
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Moderation — the four handlers from `legacy/Admin/index.js`
  //
  //  ═══════════════════════════════════════════════════════════════════
  //  THEIR AUTHORISATION WAS A FIELD IN THE CLIENT'S OWN MESSAGE
  //
  //      client.on(C.ADMIN_SET_MUTE, (data) => {
  //        let { name, privates } = data;
  //        if (!privates) return;
  //        Rule.changeMute(name, ...)
  //
  //  `privates` comes out of `data`. Sending `{name: "x", privates: true}`
  //  satisfies it. All five handlers in that file use the identical check,
  //  including `new_query`, which passes its `query` string to
  //  `Rule.runQuery` — arbitrary SQL, over a socket, authorised by the
  //  attacker's own boolean. That one is NOT ported; see the note at the end.
  //
  //  These four are legitimate operator actions and they live HERE, on
  //  user-service's transport, rather than in admin-service — because
  //  `ADMIN_ADD_CHAT` and `admin_notify` BROADCAST, and the player sockets are
  //  on this server. There is no Socket.IO cross-process adapter configured, so
  //  an emit from another service would reach nobody. `AUDIENCE.STAFF` means
  //  they still need a staff token; see `services/user/src/sockets.js`.
  //  ═══════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy SOCKET eca6e08ddde39e22f965270b7d8175d17
   *
   * `C.ADMIN_SET_MUTE` — mute or unmute a player.
   *
   * A SET, not legacy's toggle: `{name, muted}`. Two operators acting at once
   * on a toggle leave the player unmuted.
   */
  on(EVENTS.ADMIN_SET_MUTE, {
    audience: AUDIENCE.STAFF,
    handle: async (payload, context) => {
      try {
        return ok(
          await service.setMute({
            staff: context.staff,
            name: payload?.name,
            // Legacy had no such field — it flipped whatever it found.
            muted: payload?.muted !== false,
          })
        );
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 15e76a8d237dd050a301d1f33967175a
   *
   * `C.ADMIN_ADD_AVATAR` — set a player's avatar.
   */
  on(EVENTS.ADMIN_ADD_AVATAR, {
    audience: AUDIENCE.STAFF,
    handle: async (payload, context) => {
      try {
        return ok(
          await service.setAvatar({
            staff: context.staff,
            name: payload?.name,
            avatar: payload?.avatar,
          })
        );
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET 2118e57f1f2bb7979c9a7796d6be671d
   *
   * `C.ADMIN_ADD_CHAT` — post a chat message as a named player.
   *
   * Legacy broadcast `C.ADD_CHAT` from `io` with the result. Same here — this
   * is the one moderation action whose whole purpose is that every connected
   * client sees it.
   */
  on(EVENTS.ADMIN_ADD_CHAT, {
    audience: AUDIENCE.STAFF,
    handle: async (payload, context) => {
      try {
        const posted = await service.postChatAs({
          staff: context.staff,
          name: payload?.name,
          room: payload?.room ?? payload?.country,
          message: payload?.message,
        });

        // AFTER the write returned, on the event clients listen for chat on.
        context.socket.broadcast.emit(EVENTS.ADD_CHAT, encode(ok(posted)));

        return ok(posted);
      } catch (error) {
        if (error.code?.startsWith('SOCIAL_')) return refuse(error);
        throw error;
      }
    },
  });

  /**
   * @legacy SOCKET admin_notify
   *
   * A global notice to every connected client.
   *
   *     client.on('admin_notify', (data) => {
   *       let { content, privates } = data;
   *       if (!privates) return;
   *       io.emit('admin_notify', {mesage: content});
   *     });
   *
   * `mesage` — one `s`. That typo is the wire protocol: shipped clients read
   * `mesage`, so it is preserved, with the correctly-spelled key alongside it
   * for anything written against the ported API. Fixing it alone would silence
   * the notice on every existing client.
   *
   * Not persisted here. `notifications.broadcast` in admin-service is the
   * durable path — it writes a row and pushes over FCM, so a player who is not
   * connected still gets it. This is the live banner for those who are.
   */
  on(LITERAL_EVENTS.ADMIN_NOTIFY, {
    audience: AUDIENCE.STAFF,
    handle: async (payload, context) => {
      const content = String(payload?.content ?? '').trim();
      if (!content) return { status: false, msg: 'A message is required' };
      if (content.length > MAX_MESSAGE_LENGTH) {
        return { status: false, msg: `A notice may not exceed ${MAX_MESSAGE_LENGTH} characters` };
      }

      logger?.warn({ staffId: context.staff?.id, length: content.length }, 'Operator broadcast a notice');

      // `io`, not `broadcast` — the operator's own console should see it too,
      // which is what legacy's `io.emit` did.
      context.socket.server.emit(LITERAL_EVENTS.ADMIN_NOTIFY, encode({ mesage: content, message: content }));

      return ok({ delivered: true });
    },
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * `new_query` IS DELIBERATELY NOT PORTED.
   *
   *     client.on('new_query', (data) => {
   *       let { query, privates } = data;
   *       if (!privates) return;
   *       Rule.runQuery(query, (result) => {
   *         client.emit('new_query', result);
   *       })
   *     });
   *
   * Arbitrary SQL, executed and returned, authorised by a boolean the caller
   * put in their own message. It is the socket twin of `POST /pedramx`, which
   * was closed on the live box by `legacy-hotfix/` — and `Admin.runQuery` is
   * the function that hotfix disabled, so this event is already dead there.
   *
   * There is no version of this that is safe and no operation it enabled that
   * a named endpoint cannot do. It has no replacement and no gateway rewrite,
   * so a client calling it gets nothing rather than a redirect that implies
   * the capability moved.
   * ═══════════════════════════════════════════════════════════════════════
   */

  logger?.debug('Social socket events registered');
}

module.exports = { register };
