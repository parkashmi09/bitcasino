'use strict';

const { EVENTS, AUDIENCE } = require('@ibitplay/socket');

const { buildFeedService } = require('./feed.factory');

/**
 * Live sport events, over the socket.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ONE SOCKET EVENT THE SPORTS SERVICE HAS, AND IT POINTED AT LOCALHOST
 *
 * `legacy/sports/Rule.js`:
 *
 *     // url: `http://api.b365api.com/v3/events/inplay?&token=${TOKEN}&sport_id=${sportId}`,
 *     url: `http://localhost/inplay_event.json`,
 *
 * The real provider URL is commented out and the live code fetches a JSON file
 * from port 80 of the API server itself. There is no such file in the
 * repository and no route serving one, so in production this returns whatever
 * the web server answers for a missing path — an HTML 404 body, handed to the
 * client as if it were a fixture list.
 *
 * ── AND THE SPORT ID COULD BE `undefined` ────────────────────────────────
 *
 *     switch (game) {
 *       case 'soccer': sportId = 1; break;
 *       ... five cases ...
 *     }
 *
 * No `default`. `let sportId;` stays undefined for anything else, and the URL
 * is built with it anyway — `sport_id=undefined` in the commented-out version.
 * A typo in the game name was a request rather than a refusal.
 *
 * ── AND IT HAD NO GUARD ──────────────────────────────────────────────────
 *
 * `client.on(C.SPORT_GAME, …)` with no `if (!id) return`. That is defensible
 * here — a fixture list is public, and the audience below says so on purpose
 * rather than by omission. It is one of the nineteen unguarded handlers
 * counted in `docs/SOCKETS.md` §7, and one of the ones that is fine.
 *
 * The feed service this routes to is the same one the HTTP routes use: one
 * provider client, one cache, one place the upstream URL is configured.
 * ═════════════════════════════════════════════════════════════════════════
 */

const ok = (payload) => ({ status: true, ...payload });
const refuse = (error) => ({ status: false, msg: error.message, error: { code: error.code } });

function register({ on, deps }) {
  /**
   * The FACTORY, not `new FeedService(deps)`.
   *
   * The service needs a `feed` client the container does not carry. Building it
   * here separately would be a second construction path — and the first version
   * of this file skipped it entirely, so every `SPORT_GAME` threw a `TypeError`
   * on `this.feed.get` while the identical HTTP route worked.
   */
  const service = buildFeedService(deps);

  /**
   * @legacy SOCKET 1c21f3308372251321e3ed7063e7726D
   *
   * `C.SPORT_GAME` — the live board, optionally for one sport.
   */
  on(EVENTS.SPORT_GAME, {
    /**
     * PUBLIC, deliberately. A fixture list names no player and moves no money,
     * and a visitor deciding whether to sign up is exactly who reads it.
     */
    audience: AUDIENCE.PUBLIC,
    // Each miss is an upstream call against a rate-limited provider.
    limit: { windowMs: 60_000, max: 60 },
    handle: async (payload) => {
      const game = payload?.game;

      try {
        /**
         * No `game` means the whole board. Legacy required one and produced
         * `sport_id=undefined` when it did not recognise what it got.
         */
        const events = game
          ? await service.inplayByGame({ gameId: String(game) })
          : await service.allInplay();

        return ok({ game: game ?? null, events });
      } catch (error) {
        if (error.code?.startsWith('FEED_')) return refuse(error);
        throw error;
      }
    },
  });
}

module.exports = { register };
