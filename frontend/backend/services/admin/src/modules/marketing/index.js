'use strict';

/**
 * The marketing panel — read-only acquisition and deposit analytics.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS THE OTHER WELL-WRITTEN CORNER OF THE LEGACY REPOSITORY
 *
 * Unlike most of what this port has found, `system/controllers/
 * marketingController.js` and its middleware get the hard parts right, and
 * they are kept:
 *
 *   - `protectMarketing` REJECTS ANY VERB BUT GET before a handler runs, so a
 *     marketing token is structurally incapable of writing. The UI hiding the
 *     buttons is not the guarantee; this is.
 *
 *   - it RE-READS `kind` FROM THE DATABASE rather than trusting a JWT claim,
 *     with an explicit comment saying why: a plain executive token must not
 *     reach platform-wide revenue figures by knowing the URL.
 *
 *   - it re-asserts `status = 'active'` even though `protectStaff` already
 *     did, on the grounds that this middleware is the last thing between a
 *     revoked account and the numbers. Defence in depth, argued for.
 *
 *   - the date range is CAPPED at 1100 days so a hand-crafted query cannot ask
 *     for an unbounded scan, and a bad date is tagged 400 rather than 500.
 *
 *   - `created_estimated` is surfaced on every response, so the UI can mark
 *     which part of an acquisition trend sits on backfilled signup dates
 *     rather than letting a backfill spike read as real growth.
 *
 * All of that is carried over. Three things change.
 *
 * ── 1. THE MONEY IS EXACT ────────────────────────────────────────────────
 *
 * `const num = (v) => Number(v || 0);` and every volume figure through it.
 * Deposit volume summed as a double, then `.toFixed(2)` for the average.
 * Exact minor units here.
 *
 * ── 2. THE DEPOSIT ROLLUP IS BOUNDED BY THE RANGE ────────────────────────
 *
 * `customers` runs the four-table `all_deposits` CTE and a per-user rollup
 * over the PLATFORM'S ENTIRE DEPOSIT HISTORY — twice, once to count and once
 * to list — on every page of the customer directory, regardless of the range
 * asked for. That is a full scan of four tables per page view.
 *
 * ── 3. `%` AND `_` IN THE SEARCH BOX ─────────────────────────────────────
 *
 * The search term is bound as a parameter, so it is not injectable — but the
 * LIKE wildcards inside it are not escaped, so searching for `_` matches every
 * customer and searching for `%` returns the whole table. The box lies.
 */
module.exports = {
  name: 'marketing',
  service: 'admin',
  basePath: '/marketing',
  models: ['admin', 'core', 'payments', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
