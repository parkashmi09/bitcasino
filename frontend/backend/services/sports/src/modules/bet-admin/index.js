'use strict';

/**
 * The book, from the operator's side — and the switch that stops a player
 * betting.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EVERY REPORT WAS SCOPED BY A REQUEST HEADER
 *
 *     const _staffId = req.headers['x-staff-id'];
 *     const sids = (await visibleStaffIds(_staffId)).map(Number);
 *
 * Repeated in `getBetTicker`, `getNetExposureSports`, `getMarketUserBook`,
 * `getGameReport` and `/admin/betlock/users`. The caller sets that header.
 * `x-staff-id: 1` is the platform owner, so every one of these reports —
 * every open bet, every player's net position, the whole book — was one curl
 * away for anyone who could reach the port.
 *
 * The staff id comes from a verified token here and the tree is resolved by
 * admin-service, which owns `staff`.
 *
 * ── AND THE LOCKS HAD NO SCOPING AT ALL ──────────────────────────────────
 *
 *     router.post('/admin/betlock/user/toggle', async (req, res) => {
 *       const { user_id, locked } = req.body;
 *       UPDATE users SET sports_betlocked = $1 WHERE id = $2
 *
 * No staff id, no tree check, no authentication. Anyone could UNLOCK any
 * player — including one the risk team had just locked for arbitrage — and
 * lock any player they liked. `/admin/betlock/staff/toggle` is the same
 * statement against `staff`, which unlocks or locks a whole downline at once.
 *
 * Both are audited here, because a lock being lifted is precisely the event
 * somebody will want to reconstruct later.
 */
module.exports = {
  name: 'bet-admin',
  service: 'sports',
  basePath: '/bet-admin',
  models: ['sports', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
