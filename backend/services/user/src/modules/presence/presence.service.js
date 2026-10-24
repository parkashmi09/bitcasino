'use strict';

const { roomForUser } = require('@ibitplay/socket');

/**
 * How many people are actually here.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THERE WAS NO PRESENCE SOURCE ON THIS PLATFORM AT ALL
 *
 * `BACKEND-GAP-REPORT.md` §1.2 records the front end shipping
 * `onlineCount = '48,916'` as a hardcoded string beside a chat feed that is
 * genuinely live, and §6 item 4 proposes replacing it with
 * `casino/games/stats`. **That route counts GAMES, not players** —
 * `total_games`, `total_providers`, `total_types` — so it cannot answer this
 * question, and nothing else could either. `C.ONLINE` is "who am I?", an
 * identity read on one socket.
 *
 * So this is the source. It is derived from the transport rather than stored,
 * which is the right shape for presence: a table of "who is online" is a table
 * that is wrong the moment a process dies without cleaning up after itself.
 *
 * ── WHAT THE NUMBERS MEAN ────────────────────────────────────────────────
 *
 *   connections  every open socket, signed in or not.
 *   players      DISTINCT signed-in accounts. The connection handler joins
 *                each authenticated socket to `user:<id>`, so one account on
 *                a phone and a laptop is one room and counts once — which is
 *                what "online" should mean.
 *   guests       connections not in any user room.
 *
 * ── AND THE LIMIT, WHICH IS NOT COSMETIC ─────────────────────────────────
 *
 * Socket.IO's default adapter keeps its room table in THIS PROCESS'S memory.
 * With `REDIS_URL` unset — which is the state described in §5.3 — a second
 * casino or user process has its own table, and neither can see the other's.
 * So this is the count for one process, and `scope` says so rather than
 * letting a caller read a partial number as a total.
 *
 * Configure Redis and the adapter aggregates across processes; the shape of
 * this answer does not change, only its truthfulness. That is why `scope` is
 * on the wire from the start.
 * ═════════════════════════════════════════════════════════════════════════
 */
class PresenceService {
  constructor(deps) {
    this.deps = deps;
    this.logger = deps.logger;
  }

  /**
   * The socket server.
   *
   * Read LAZILY, on every call. `createContainer()` builds the modules and
   * `attachSockets()` runs after it, so an `io` captured in a constructor is
   * always `undefined`. Reading it per request is what makes the route work at
   * all — and it stays correct if the transport is ever restarted underneath.
   */
  get #io() {
    return this.deps.io ?? null;
  }

  count() {
    const io = this.#io;

    /*
     * No transport. Answering zeros would be a lie shaped like data — a caller
     * cannot tell "nobody is here" from "the socket server is not attached".
     */
    if (!io) {
      return { available: false, connections: 0, players: 0, guests: 0, scope: 'process' };
    }

    const namespace = io.of('/');
    const connections = namespace.sockets.size;

    /*
     * Distinct signed-in accounts.
     *
     * Every socket is also in a room of its own id, so the room table cannot
     * simply be counted — only the `user:` rooms are accounts. `roomForUser`
     * is imported rather than the prefix being retyped: the two must agree, and
     * a typo here would silently report zero players forever.
     */
    const prefix = roomForUser('');
    let players = 0;
    let inUserRooms = 0;

    for (const [name, members] of namespace.adapter.rooms) {
      if (!name.startsWith(prefix)) continue;
      players += 1;
      inUserRooms += members.size;
    }

    return {
      available: true,
      connections,
      players,
      /* Never negative: a socket can leave between the two reads above. */
      guests: Math.max(0, connections - inUserRooms),
      /**
       * `process` until Redis is configured. A caller showing this as a
       * platform total should know it is a floor, not a total.
       */
      scope: this.deps.config?.REDIS_URL ? 'cluster' : 'process',
    };
  }
}

module.exports = { PresenceService };
