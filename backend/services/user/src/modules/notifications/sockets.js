'use strict';

const { PLATFORM_EVENTS, AUDIENCE } = require('@ibitplay/socket');
const { NotificationsService } = require('./notifications.service');

/**
 * The notification badge over the socket: `notificationsUnread` answers
 * `{ status: true, unread }`, the same count `GET /notifications/unread-count`
 * gives, so a client that keeps the socket open never polls HTTP for it.
 */
function register({ on, deps }) {
  const service = new NotificationsService(deps);

  on(PLATFORM_EVENTS.NOTIFICATIONS_UNREAD, {
    audience: AUDIENCE.USER,
    handle: async (_payload, context) => {
      const { unread, byCategory } = await service.unreadCount({ userId: context.userId });
      return { status: true, unread, byCategory };
    },
  });
}

module.exports = { register };
