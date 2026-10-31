'use strict';

const { z } = require('@ibitplay/common');

const { NOTIFICATION_TYPE_NAMES } = require('./notifications.constants');

const id = z.coerce.number().int().positive();

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

/**
 * The message.
 *
 * Bounded, because it renders on a lock screen and because legacy accepted
 * whatever arrived on an unauthenticated route. `data` is a flat object — FCM
 * requires string values and nesting is silently dropped, so a caller sending
 * an object gets it serialised rather than lost.
 */
const message = {
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(1000).optional(),
  type: z.enum(NOTIFICATION_TYPE_NAMES).default('general'),
  data: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Direct Users | Agent Users tab; agent users take general notifications only. */
  channel: z.enum(['direct', 'agent']).default('direct'),
};

const sendToUser = { body: z.object({ userId: id, ...message }).strict() };

/** No recipient list. A broadcast reaches the caller's tree, by definition. */
const broadcast = { body: z.object(message).strict() };

const listDevices = {
  query: paging.extend({
    userId: id.optional(),
    activeOnly: z.coerce.boolean().default(true),
    /** Direct Users | Agent Users tab. Na ho = dono. */
    channel: z.enum(['direct', 'agent']).optional(),
  }),
};

const userParam = { params: z.object({ userId: id }), query: paging };

/** No `userId` — the player comes from their own token. */
const registerDevice = {
  body: z
    .object({
      // An FCM token. Long and opaque; bounded so it cannot be used to store
      // arbitrary data in the table.
      token: z.string().trim().min(20).max(4096),
      platform: z.enum(['android', 'ios', 'web']).optional(),
    })
    .strict(),
};

const markRead = {
  body: z
    .object({ notificationIds: z.array(id).min(1).max(500).optional() })
    .strict(),
};

const listSends = { query: paging.extend({ channel: z.enum(['direct', 'agent']).default('direct') }) };

const sendParam = z.object({ sendId: z.string().uuid() });

/** Title and body only: changing the type would change who it was meant for. */
const updateSend = {
  params: sendParam,
  body: z.object({ title: message.title, body: z.string().trim().max(1000).optional() }).strict(),
};

const deleteSend = { params: sendParam };

module.exports = { sendToUser, broadcast, listDevices, userParam, registerDevice, markRead, listSends, updateSend, deleteSend };
