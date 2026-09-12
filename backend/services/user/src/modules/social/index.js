'use strict';

/**
 * Chat, friends and private messages.
 *
 * A socket-only surface — none of these had an HTTP route in legacy, so the
 * module has no routers. It exists to own the service and its constants; the
 * events are registered from `sockets.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. THE MESSAGE WAS BROADCAST BEFORE IT WAS STORED
 *
 * `Rule.addChat` calls back — which the handler turns into
 * `io.emit(C.ADD_CHAT, result)`, to every connected client — and THEN runs the
 * INSERT:
 *
 *     callback({ country: c, message, name, uid: id, ... }, false);
 *
 *     pg.query("INSERT INTO " + table + "(...) VALUES(...)", [...],
 *       function (err, result) {
 *         if (err) {
 *           console.log("error on UserRule: 720", err);
 *           Notify.send("New Chat => " + name + " / Content: " + message);
 *           return callback(false, true);       // ← the SECOND callback
 *         }
 *       });
 *
 * If the insert fails, every player has already seen a message that does not
 * exist — it is gone on the next page load. And the error path calls the
 * callback a second time, which the handler happily emits again.
 *
 * ── 2. NO LENGTH LIMIT, ANYWHERE ─────────────────────────────────────────
 *
 * `message` goes from the socket into the table and out to every connected
 * client with no bound. One player can push a megabyte to everybody.
 *
 * ── 3. THE ERROR PATH THROWS ─────────────────────────────────────────────
 *
 *     Rule.getUserInfo(id, (results, er) => {
 *       if (er) {
 *         console.log("User Not Found on UserRule: 846", err);
 *
 * The parameter is `er`. `err` is not defined in that scope, so the branch that
 * handles "user not found" throws `ReferenceError` — inside a callback, with no
 * try/catch above it.
 *
 * ── AND ONE THING IT GOT RIGHT ───────────────────────────────────────────
 *
 *     const allowed = ["global", "brazil"];
 *     if (!_.includes(allowed, country)) return callback(false, true);
 *     const table = "chat_" + country;
 *
 * The concatenation is guarded by a real allowlist checked first. Unlike
 * `makeRain`, which built the same table name from an unvalidated `room`, this
 * one is safe — worth saying, because the two look identical at a glance.
 */
module.exports = {
  name: 'social',
  service: 'user',
  basePath: '/social',
  models: ['core', 'extended'],
  /**
   * Socket-only. None of these had an HTTP route in legacy and none needs one;
   * the events live in `sockets.js` and are registered by the service's socket
   * transport, which attaches the audience guards.
   *
   * The flag is required by the loader — an empty `routers` object on its own
   * is rejected, because a module whose routes silently do not mount is a far
   * more common mistake than a deliberately socket-only one.
   */
  routers: {},
  socketOnly: true,
};
