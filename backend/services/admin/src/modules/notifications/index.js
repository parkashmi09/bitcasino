'use strict';

/**
 * Push notifications — the device tokens, the send, and the history.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `POST /firebase/send-bulk` WAS AN UNAUTHENTICATED BROADCAST
 *
 *     router.post('/send-bulk', async (req, res) => {
 *       const { title, body, type, data } = req.body;
 *       const results = await NotificationService.sendBulk({ title, body, type, data });
 *
 * No middleware on the router. Anyone who could reach the port could push a
 * notification, with their own title and body, to EVERY registered device on
 * the platform — from the operator's own app, carrying its icon and its name.
 * "Your account is locked, tap here." The same shape as the `/email/bulk` open
 * relay found earlier, on a channel players trust more.
 *
 * `send-to-user` is the same hole aimed at one person, and `GET /allToken`
 * returned every FCM token on the platform to anyone who asked — which is
 * enough to push to those devices directly through Firebase, without going
 * through this API at all.
 *
 * ── AND FIVE OF THE SEVEN NEVER WORKED ───────────────────────────────────
 *
 * `user_notifications` is referenced five times and was never created — not in
 * the baseline, not in any migration. Every send, every read receipt and every
 * history lookup has returned "relation does not exist". Migration 026 creates
 * it; it is the fourth table in this port with that story, after
 * `club_memberships`, the club broadcast tables and `admin_fancy_control`.
 *
 * ── ON THE FIREBASE CREDENTIAL ───────────────────────────────────────────
 *
 * The service account key is committed to the repository as
 * `bitcoinjito-e3078-firebase-adminsdk-*.json`. It is on the rotation list and
 * has been since the first batch — a Firebase admin key can send to every
 * device the project knows about and read the project's data.
 */
module.exports = {
  name: 'notifications',
  service: 'admin',
  basePath: '/notifications',
  models: ['admin', 'core', 'extended'],
  routers: {
    admin: require('./routes/admin.routes'),
    internal: require('./routes/internal.routes'),
  },
};
