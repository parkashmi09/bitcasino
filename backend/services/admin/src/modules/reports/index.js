'use strict';

/**
 * Player reports — the customer directory, the per-player sheet, the export.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE WHOLE `/reports` ROUTER WAS UNAUTHENTICATED
 *
 *     server.use('/reports', reportRoutes);
 *
 * and `legacy/reports/routes.js` in full:
 *
 *     router.get('/user/:userId', getUserReports);
 *     router.get('/users',        getAllUsersReports);
 *     router.get('/export',       exportUsersReports);
 *
 * No `protectStaff`, no middleware of any kind, on three routes that read the
 * customer database. `GET /reports/export` returned a CSV of every direct
 * player on the platform — id, name, referral code, balance, deposit balance,
 * total deposited, total withdrawn — to anyone who could reach the port. That
 * is the customer list and the money each of them holds, in one GET, as a file
 * download.
 *
 * `/reports/user/:userId` returned one player's entire `credits` row for any id
 * anybody cared to type.
 *
 * ── AND `/api/admin/balance-sheet/:userId` TRUSTED THE URL ────────────────
 *
 * That one HAS `protectStaff`, and its route file explains why it needs no
 * hierarchy check:
 *
 *     // Any authenticated staff member may view a user's balance sheet. The
 *     // user-listing endpoints are already scoped per-staff, so each staff only
 *     // ever has IDs for users within their own downline to look up here.
 *
 * The premise is that an agent cannot obtain an id outside their downline. Ids
 * are sequential integers. Any agent could read the complete financial history
 * of every player on the platform — including players belonging to a rival
 * agent — by counting. The hierarchy is checked here.
 *
 * ── THREE MORE THINGS THAT WERE WRONG ────────────────────────────────────
 *
 * 1. CSV INJECTION. The export escaped quotes in `name` and nothing else. A
 *    player registering as `=cmd|'/c calc'!A1` puts a formula in a cell of a
 *    file the operator opens in Excel. Every value is prefixed here.
 *
 * 2. N+1, UNBOUNDED. The listing ran two extra queries PER USER, and `limit`
 *    came from the query string with no ceiling. `?limit=100000` is 200,001
 *    queries — on legacy's single shared `pg.Client`, that serialises the
 *    entire platform behind one request. One JOIN now, and a bounded page.
 *
 * 3. THE VIP LEVEL WAS ONE TOO HIGH. `getVipLevelDetails` returned
 *    `vipLevel: nextVip.level` — the level the player had NOT reached — and put
 *    the real one in `previousVipLevel`. Every report displayed every player a
 *    tier above where they were. The ladder is shared with user-service now
 *    (`@ibitplay/common`), so the operator's screen and the player's screen
 *    cannot disagree.
 */
module.exports = {
  name: 'reports',
  service: 'admin',
  basePath: '/reports',
  models: ['admin', 'core', 'payments', 'sports', 'casino', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
  },
};
