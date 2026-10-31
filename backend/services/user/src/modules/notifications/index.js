'use strict';

/**
 * A player's own notification inbox.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * NONE OF THIS IS NEW LOGIC — IT IS A DOOR ONTO LOGIC THAT ALREADY EXISTED
 *
 * `services/admin/src/modules/notifications` has carried `history`,
 * `unreadCount` and `markRead` since the port, `user_notifications` is a
 * complete table (migration 026), and its `internal.routes.js` opens with the
 * comment "What a PLAYER does with their own notifications … user-service
 * proxies the three player-facing actions".
 *
 * That proxy was never written. So the routes existed, the table existed, the
 * service existed — and a player had no inbox, because `/internal/` is blocked
 * at the gateway and nothing on this side reached it. The bell in the header
 * and the phone's notification page had nothing to call.
 *
 * ── WHY IT PROXIES RATHER THAN READING THE TABLE ─────────────────────────
 *
 * Admin-service owns the sending side, and both services writing
 * `user_notifications` is how a read receipt and a send end up disagreeing
 * about a row. The internal routes are the seam the platform already chose;
 * this module is the client for them, the same way `gift-cards` and
 * `deposit-reports` call casino- and admin-service for what they do not own.
 *
 * The cost is one internal hop per read, which is what every other
 * cross-domain read here already pays.
 */
module.exports = {
  name: 'notifications',
  service: 'user',
  basePath: '/notifications',
  /* No models: this module owns no table and reads none directly. */
  models: [],
  routers: {
    user: require('./routes/user.routes'),
  },
};
