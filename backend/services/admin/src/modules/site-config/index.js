'use strict';

/**
 * Platform settings — the `siteconfig` row.
 *
 * ── WHY THIS IS IN admin-service AND NOT WITH THE AFFILIATE CODE ─────────
 *
 * Legacy served `GET /affiliateAdmin/settings` and `PUT /affiliateAdmin/settings`
 * from `affiliate/adminAffiliateController.js`, alongside the referral
 * programme. But the three values they touch — `affiliatebonus`,
 * `comissionpercent`, `registerbonus` — are columns on `siteconfig`, and
 * `siteconfig` belongs to the `admin` model domain. user-service loads
 * `core`, `payments` and `extended`; it never registers that model, so an
 * affiliate module in user-service reaching for it would find `undefined` at
 * runtime rather than failing at boot.
 *
 * The rest of the `siteconfig` surface lands here too as the admin port
 * continues, which is the other reason: one owner for one table.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────
 *
 *   NEITHER ROUTE HAD ANY MIDDLEWARE. `router.get('/settings', ...)` and
 *   `router.put('/settings', ...)` were mounted on `/affiliateAdmin` with
 *   nothing in front of them — not a staff check, not even the shared
 *   `role-key` header the bonus routes used. An unauthenticated PUT set the
 *   commission percentage and the registration bonus, which is a direct lever
 *   on what the platform pays out.
 *
 *   THE UPDATE HAD NO WHERE CLAUSE. `UPDATE siteconfig SET ... RETURNING ...`
 *   rewrote every row and reported an arbitrary one back.
 *
 *   THE READ WAS `LIMIT 1` WITH NO ORDER BY, so which settings were in force
 *   was up to the planner. Migration 021 gives the table a primary key and,
 *   where the data allows, a single-row constraint.
 *
 *   `parseFloat` ON THE WAY IN. A commission of `1e9` was accepted and stored
 *   as a billion percent.
 */
module.exports = {
  name: 'site-config',
  service: 'admin',
  basePath: '/site-config',
  // `core` for `users` and `userconfig` — the per-user preference routes scope
  // a player to the caller's tree before reading or writing their settings.
  models: ['admin', 'core'],
  routers: {
    // The feature flags every browser renders from — see public.routes.js for
    // why an admin-owned table has a public read, and what it does not return.
    public: require('./routes/public.routes'),
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
