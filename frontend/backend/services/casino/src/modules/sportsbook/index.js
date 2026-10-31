'use strict';

/**
 * Third-party sportsbook aggregator (Slotegrator betting).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `legacy/sportsbook/routes.js` IS NEVER MOUNTED. `index.js` does not require
 * it, so its five endpoints have never served a request. Nothing here is
 * bug-compatible with anything, because there is no production behaviour to be
 * compatible with.
 *
 * Four of the five are ported. The fifth is not, and will not be:
 *
 *   GET /sportsbooks/launch?url=…  fetched whatever URL the caller named and
 *   returned the body — a server-side request proxy inside the platform's
 *   network, forwarding the caller's IP so the target's logs blamed them. What
 *   it was FOR is covered: `init` returns the launch URL and the browser opens
 *   it directly. See `sportsbook.validators.js`.
 *
 * The other three defects share one cause — the session id was generated and
 * discarded. `init` took `player_id` from the body, `logout` ended whatever
 * session a body token named, and `refresh-token` opened a new session because
 * there was none to refresh. Migration 031 stores the session; the guard is
 * then just "is this row yours".
 *
 * Merchant credentials were hard-coded (`856e1604…` / `abf806ce…`, staging).
 * Rotate them with Slotegrator — `docs/ROTATION.md`.
 *
 * WHY THE CASINO SERVICE: this launches a third-party session and lets the
 * provider's wallet move the balance, exactly like GIS, XGaming and nexus. The
 * sports service owns OUR book — `"SportsBet"`, exposure, settlement, our own
 * liability — and a foreign wallet integration does not belong inside it.
 * ─────────────────────────────────────────────────────────────────────────
 */
module.exports = {
  name: 'sportsbook',
  service: 'casino',
  basePath: '/sportsbook',
  models: ['casino', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
    user: require('./routes/user.routes'),
  },
};
