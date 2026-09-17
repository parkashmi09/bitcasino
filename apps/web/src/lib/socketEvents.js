/**
 * The socket event names this app sends, copied byte-for-byte from
 * `backend/docs/SOCKET-API.md` §9.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THESE ARE OPAQUE HASHES AND THEY ARE THE PROTOCOL. DO NOT RETYPE THEM.
 *
 * One character different and the event silently stops working: the server
 * listens on one string, the client sends another, and **neither side
 * errors**. It just goes quiet — no 404, no refusal, no reply. The request
 * sits there until the ack times out.
 *
 * The server has a test pinning its whole table against the legacy constant
 * file, and `createSocketServer.on()` refuses to register a name that is not
 * in it. The client has no such backstop, which is why these were copied
 * rather than transcribed, and why `verify-socket-events.mjs` diffs this file
 * against the backend's own table.
 *
 * Several values contain characters no hash function produces —
 * `f2ca6e08d1e7d76f6ddcbcdubci73bd3` has `ubci` in the middle of it. They were
 * hand-edited upstream at some point and are still what the wire expects.
 * They are NOT typos. `ONLINE_LOGGED` and `LOGIN_USER` differ by three
 * characters in the middle and are two different events.
 * ═════════════════════════════════════════════════════════════════════════
 */

export const EVENTS = Object.freeze({
  /**
   * Rebind an already-open connection to a player who has just signed in.
   *
   * `public` by necessity — an anonymous socket is exactly who sends it. The
   * transport verifies the token, so the handler never sees an id it could
   * trust. Without this, a visitor who signs in without reloading has every
   * `player` event refused for the life of the connection.
   */
  ONLINE_LOGGED: 'faf9ba208bd90e2313b6faeede53b801',

  /** The player's deposit address for a coin and chain. A read, not a mint. */
  GET_ADDRESS: '396bbdcf7c16c3f3795d932b698ef78f',

  /** A withdrawal request. Verified against the account password server-side. */
  SUBMIT_NEW_WITHDRAWL: '7c0b37955cf21c7f2f3773c1268edc08',

  /** Convert one coin to another. */
  SUBMIT_NEW_SWAP: 'f2ca6e08d1e7d76f6ddcbcdubci73bd3',

  /** The player's wallet movements. */
  WALLET_HISTORY: 'c23c59dd3258d3a53d7132652f8bf98a',

  /** The signed-in player's own record. */
  USER_INFO: '18566cda79f670c2098360799275aa31',

  /** Send a tip to another player. */
  SEND_TIP: '573a867973fa586555cab080e7d837ad',

  // ── The live surfaces. All four PUBLIC — a signed-out visitor sends them ──

  /**
   * Everyone's most recent settled rounds, newest first.
   *
   * The home ticker. Rows are `{name, avatar, game, coin, amount, profit, at}`
   * where `profit` is SIGNED — the feed carries losses as well as wins, and
   * filtering to the wins is the client's job, not the server's.
   *
   * user-service answers it by calling casino-service over the internal
   * network, which is why a bet feed lives on the wallet's connection.
   */
  LAST_BETS: '62f8c260fbce6de8e5ed19767977cc1e',

  /**
   * The same feed narrowed to one game. Takes `{game}` — the in-house game
   * KEY (`limbo`, `dice`, `crash`), not a catalogue slug and not a title.
   *
   * Measured against the running service on 2026-09-09, because the two
   * failure shapes are not the one you would guess:
   *
   *     {game: 'limbo'}       {status: true, game, bets: [...]}
   *     {game: 'not-a-game'}  {status: true, game, bets: []}      ← a LIST
   *     {game: ''} / {}       {status: false, error: PROFILE_NOT_FOUND}
   *
   * So an unknown game is an EMPTY FEED, not a refusal — the handler only
   * guards the empty string, and anything else is passed through to
   * casino-service, which has no such game and no rows for it. A caller that
   * sends a provider title's slug therefore gets silence rather than an
   * error, which is why the caller checks `isPlayable` first.
   */
  LAST_BETS_BY_GAME: 'b87a2e8036f0617125ffb69dd5673d7b',

  /**
   * The biggest recent wins, same row shape under `winners` rather than
   * `bets`. Ordered by profit, not by time — the two lists overlap and are
   * not the same list sorted differently, because a big win from an hour ago
   * outranks a small one from a minute ago.
   */
  TOP_WINNERS: 'b7cafd57089c07ade71b7776085660a0',

  /**
   * The platform's announcements — the twenty newest, as
   * `{notifications: [{title, content, date}]}`.
   *
   * There is no id on a row: the `notifications` table has no primary key at
   * all (see `useNotifications` for what that costs the read-set).
   */
  NOTIFICATION: 'f37bd2f66651e7d76f6d38770f2bc5dd',

  /**
   * One round of Limbo — casino-service, not user-service.
   *
   * The first in-house original wired up. It is the simplest shape the
   * `in-house` module has: one message in (`{coin, amount, payout}`), one
   * settled round back, no open/cash-out step. The other nineteen follow the
   * same two envelopes and are deliberately not here yet — a name in this
   * table that nothing sends is a name nothing verifies.
   */
  PLAY_LIMBO: '18867ffabc768e07378cdaa6df18c75c',
});

/**
 * Events whose wire name is a plain string rather than a hash.
 *
 * `@ibitplay/socket` keeps these in its own `LITERAL_EVENTS` table, separate
 * from `EVENTS`, because they were never put through legacy's hashing step —
 * they are the handful of names that were typed directly into both ends.
 *
 * Kept apart here for the same reason, and because `verify-socket-events.mjs`
 * has to parse them out of a different table on the backend side.
 */
export const LITERAL_EVENTS = Object.freeze({
  /**
   * The operator's live banner broadcast.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * IT EMITS `{mesage: …}` — ONE `s` — AND THAT TYPO IS THE WIRE PROTOCOL.
   *
   * Shipped clients read `mesage`, so the platform cannot fix it without
   * silencing the notice everywhere. The correctly-spelled key is sent
   * ALONGSIDE it, so anything written against the ported API can read
   * `message` — but a client that reads only the correct spelling would go
   * quiet the moment it spoke to an older build, which is why the reader in
   * `queries/live.js` takes whichever arrives.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * RECEIVE-ONLY from this app. Sending it needs a staff token, and there is
   * no staff surface here.
   *
   * Not persisted: `notifications.broadcast` in admin-service is the durable
   * path that writes a row and pushes over FCM. This is the live banner for
   * whoever happens to be connected, which is why it is a transient toast
   * rather than a row in the notifications feed.
   */
  ADMIN_NOTIFY: 'admin_notify',
});

/**
 * Which service owns each event.
 *
 * The four services each attach their own Socket.io server on their own port —
 * the gateway proxies HTTP only. Most of the table is user-service (`:4001`),
 * which is what `vite.config.js` points `/socket.io` at. The `PLAY_*` rounds
 * are casino-service (`:4003`), reached through the `/casino-socket` rewrite.
 *
 * **The split is not a deployment detail, it is a correctness one.** An
 * in-house round is a stake debit, a result and a payout in ONE transaction
 * against `bets`, `credits` and `house` — casino tables. user-service does not
 * load that domain, so the round cannot live there without putting a network
 * hop inside the transaction that has to be atomic. `casino/src/sockets.js`
 * says the same thing from the other side.
 */
const CASINO_EVENTS = ['PLAY_LIMBO'];

export const EVENT_SERVICE = Object.freeze(
  Object.fromEntries(
    Object.keys(EVENTS).map((name) => [name, CASINO_EVENTS.includes(name) ? 'casino' : 'user']),
  ),
);

/**
 * The same map keyed by the WIRE name, which is what a caller actually holds.
 *
 * `request(EVENTS.GET_ADDRESS)` passes a hash, not `'GET_ADDRESS'`, so routing
 * it to the right connection means going from hash back to service. Built once
 * here rather than by scanning `EVENTS` on every send.
 */
export const SERVICE_OF = Object.freeze(
  Object.fromEntries(
    Object.entries(EVENTS).map(([name, hash]) => [hash, EVENT_SERVICE[name]]),
  ),
);
