'use strict';

/**
 * Owner System Tracker — zip ka System Tracker, ab sirf OWNER PANEL (port 3085) me.
 * Site admin me ye screen nahi hai; owner panel apni `x-owner-key` (OWNER_SHARED_SECRET) se
 * padhta hai, staff token se nahi (jaise owner panel ki Coins screen).
 *
 *   GET  /api/v1/admin/owner/system-tracker/alerts
 *   POST /api/v1/admin/owner/system-tracker/scan
 *   GET  /api/v1/admin/owner/system-tracker/watchdog?all=1
 *   POST /api/v1/admin/owner/system-tracker/watchdog/scan
 *   POST /api/v1/admin/owner/system-tracker/watchdog/:id/acknowledge
 *   GET  /api/v1/admin/owner/system-tracker/search?q=
 *   GET  /api/v1/admin/owner/system-tracker/:idOrUsername[/provenance]
 *
 * Code (scanner, report, provenance, watchdog) `exchange-accounts/systemTracker/*` me hi hai.
 * Yahan se paisa nahi hilta.
 */
module.exports = {
  name: 'owner-system-tracker',
  service: 'admin',
  basePath: '/owner/system-tracker',
  models: ['admin', 'core', 'extended'],
  routers: {
    public: require('./routes/public.routes'),
  },
};
