'use strict';

const { AppError } = require('@ibitplay/common');

/**
 * The global sports on/off switch.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT `sportsmiddleware.js` ACTUALLY DID
 *
 *     const q = await db.query('SELECT sports FROM siteconfig LIMIT 1');
 *     if (!q.rows[0]?.sports) return res.status(403).json({...});
 *
 *     if (!req.body || !req.body.gameId) return next();
 *     // ... then check sports_config for that game
 *
 * Three things worth saying about that:
 *
 *   IT IS NOT AUTHENTICATION. It was the only middleware in front of the
 *   sports API — including `POST /sports-config`, `PUT /sports/:id` and the
 *   five fancy-control routes, which are administrative writes. A feature flag
 *   was standing where a permission check belonged. Those routes are on the
 *   admin router in `modules/catalogue` now; this stays in front of the reads,
 *   where it belongs.
 *
 *   THE PER-GAME CHECK NEVER RAN. It reads the game id from `req.body`, and
 *   thirty of the thirty-three routes are GETs with no body. Only `POST
 *   /inplay` ever reached the second half.
 *
 *   IT WAS A DATABASE QUERY PER REQUEST, `LIMIT 1` with no ORDER BY against a
 *   table that had no primary key until migration 021.
 *
 * ── WHY THIS ASKS admin-service ──────────────────────────────────────────
 *
 * `siteconfig` is in the `admin` model domain. sports-service loads `sports`,
 * `core` and `extended`, so it cannot read that table — and widening its
 * domain list to reach one boolean would hand it every admin table. It asks
 * over the internal API instead, and caches the answer for a few seconds so a
 * page load is one call rather than thirty.
 *
 * ── AND IT FAILS OPEN, DELIBERATELY ──────────────────────────────────────
 *
 * If admin-service cannot be reached, the board stays up. This flag exists so
 * an operator can take sports down on purpose; an outage in an unrelated
 * service is not that decision, and turning the board dark because a lookup
 * timed out is a worse failure than showing odds for a few seconds longer than
 * intended. The betting path does not rely on this — a bet is checked against
 * the market, not against a cached flag.
 */

const DEFAULT_TTL_MS = 5_000;

function sportsEnabled({ clients, logger, config } = {}) {
  const ttlMs = Number(config?.SPORTS_ENABLED_TTL_MS ?? DEFAULT_TTL_MS);

  let cached = { value: true, expires: 0 };
  let inFlight = null;

  async function read() {
    if (cached.expires > Date.now()) return cached.value;
    if (inFlight) return inFlight;

    inFlight = clients.admin
      .get('/internal/admin/site-config/sports')
      .then((body) => {
        const value = Boolean(body?.data?.sportsEnabled ?? body?.sportsEnabled ?? true);
        cached = { value, expires: Date.now() + ttlMs };
        return value;
      })
      .catch((error) => {
        // Fail open — see the note above. Cached briefly so a sustained outage
        // does not turn into a request-rate call storm against a dead service.
        logger?.warn({ err: error }, 'Could not read the sports enabled flag — leaving the board up');
        cached = { value: true, expires: Date.now() + ttlMs };
        return true;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return async function sportsEnabledGuard(_req, _res, next) {
    try {
      const enabled = await read();
      if (!enabled) {
        return next(new AppError('Sports betting is currently unavailable', 503, 'FEED_SPORTS_DISABLED'));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { sportsEnabled };
