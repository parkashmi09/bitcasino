'use strict';

/**
 * Player settings — `userconfig`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two socket events served this table in legacy and BOTH took the player id
 * from the client's message:
 *
 *     socket.on("identify", async (raw) => {
 *       const uid = Number(raw);              // ← any number you like
 *       socket.userid = uid;
 *       socket.join(ROOM.u(uid));
 *       socket.emit("userConfigUpdated", await userModel.get(uid));
 *     });
 *
 *     socket.on('subscribeUserConfig', id => socket.join(ROOM.u(id)));
 *
 * `identify` returned another player's settings and left you joined to their
 * room for every later push. `subscribeUserConfig` is one line with no check at
 * all — its own comment calls it an "admin preview", and nothing limited it to
 * an admin.
 *
 * `identify` takes no id here; the connection has one already. The preview is
 * `AUDIENCE.STAFF`. And the file that registered these called
 * `io.on('connection')` from inside a connection handler, so listener count
 * grew with connection count — see `docs/SOCKETS.md` §4.
 * ─────────────────────────────────────────────────────────────────────────
 */
module.exports = {
  name: 'preferences',
  service: 'user',
  basePath: '/preferences',
  models: ['core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};
