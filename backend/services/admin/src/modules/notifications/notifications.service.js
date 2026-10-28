'use strict';

const crypto = require('crypto');
const { Op, fn, col, literal } = require('sequelize');

const errors = require('./notifications.errors');
const { NOTIFICATION_TYPES, MAX_BROADCAST_DEVICES, FCM_BATCH_SIZE } = require('./notifications.constants');
const { visibleStaffIds } = require('../staff-directory/staffDirectory.service');
const { FeaturesService } = require('../features/features.service');


/**
 * Sending a push, and the record of what was sent.
 *
 * The record is written first and the push attempted second. A notification
 * that reached a device but has no row is invisible to support; a row whose
 * push failed is at least answerable. Legacy wrote the row and the push in the
 * same statement path and recorded neither outcome.
 */
/**
 * `types` keeps only those types; `excludeTypes` drops those. Both optional
 * and additive — the player panel's tabs (user-service maps a tab to its
 * types) and the agent-tree rule (no promotions) — so every existing caller,
 * which passes neither, reads exactly what it read before. (`type` is NOT
 * NULL, so no null case.)
 */
function typeWhere(types, excludeTypes) {
  const and = [];
  if (types?.length) and.push({ type: { [Op.in]: types } });
  if (excludeTypes?.length) and.push({ type: { [Op.notIn]: excludeTypes } });
  return and.length ? { [Op.and]: and } : {};
}

class NotificationsService {
  constructor({ models, db, logger, config, push, features, fetchImpl }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    /**
     * Where the site's push INTEGRATION is read from — the owner panel's
     * OneSignal keys, sealed in `site_features`. Looked up on every send, so
     * keys entered in the panel apply to the next notification without a
     * restart. A test may inject its own.
     */
    this.features = features ?? (models?.SiteFeature ? new FeaturesService({ models, logger, config, fetchImpl }) : null);
    /**
     * The transport. Injected so this service is testable without Firebase and
     * so a deployment with no credential still records notifications rather
     * than failing at boot — see `PUSH_NOT_CONFIGURED`.
     */
    this.push = push ?? null;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Devices
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /firebase/register
   *
   * A device registering to receive pushes.
   *
   * The player comes from their own token — this is the one route here a
   * PLAYER calls, and legacy took `userId` from the body with no
   * authentication, so anyone could register their device against anyone's
   * account and receive that player's notifications.
   */
  async registerDevice({ userId, token, platform }) {
    /**
     * One row per token. A token that re-registers is the same device, and it
     * may have moved to a different account — a shared phone, a reinstall — so
     * the owner is updated rather than a second row created.
     */
    const [row] = await this.models.UserFcmToken.upsert(
      {
        user_id: userId,
        token,
        platform: platform ?? null,
        is_active: true,
        updated_at: new Date(),
        created_at: new Date(),
      },
      { conflictFields: ['token'], fields: ['user_id', 'platform', 'is_active', 'updated_at'], returning: true }
    );

    return { registered: true, platform: platform ?? null, id: row?.id ?? null };
  }

  /**
   * @legacy GET /firebase/allToken
   *
   *   LEGACY RETURNED EVERY TOKEN ON THE PLATFORM to anyone who asked. A push
   *   token is a capability: whoever holds it can send to that device through
   *   Firebase directly, without going through this API at all.
   *
   * Scoped to the caller's tree, paged, and the token itself is truncated —
   * enough to identify a row in a support conversation, not enough to use.
   */
  async listDevices({ staff, userId, activeOnly = true, channel, limit = 50, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff, channel);
    const scope = userId ? [this.#assertVisible(visible, userId)] : visible;

    const { rows, count } = await this.models.UserFcmToken.findAndCountAll({
      where: { user_id: scope, ...(activeOnly ? { is_active: true } : {}) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    /**
     * Who each device belongs to.
     *
     * A bare `user_id` is unreadable in a support conversation, which is the
     * one thing this list is for — legacy answered with `name` and `email` on
     * every row and the panel is still built around them. Fetched by id for
     * the rows in THIS page rather than joined, so the count above stays a
     * count of devices and the query does not grow a join per page.
     */
    const owners = await this.#ownersOf(rows.map((r) => r.user_id));

    return {
      total: count,
      rows: rows.map((r) => {
        const owner = owners.get(String(r.user_id));
        return {
          id: r.id,
          userId: r.user_id,
          name: owner?.name ?? null,
          email: owner?.email ?? null,
          platform: r.platform,
          active: Boolean(r.is_active),
          // Identifiable, not usable.
          token: this.#maskToken(r.token),
          registeredAt: r.created_at,
        };
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Sending
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /firebase/send-to-user
   *
   * Push to one player, and record it.
   */
  async sendToUser({ staff, userId, title, body, type, data, channel = 'direct' }) {
    const visible = await this.#visibleUserIds(staff, this.#channelFor(channel, type));
    this.#assertVisible(visible, userId);

    const record = await this.#record([userId], { title, body, type, data, staff });

    const onesignal = await this.#oneSignal();
    if (onesignal) {
      const outcome = await onesignal.sendToUsers([userId], { title, body, type, data });
      await this.#markDelivered(record, outcome);
      this.logger?.info({ userId, staffId: staff?.id, provider: 'onesignal', accepted: outcome.accepted }, 'Notification sent to one player');
      return { recorded: record.length, delivered: outcome.accepted, devices: null, provider: 'onesignal' };
    }

    const tokens = await this.#tokensFor([userId]);
    if (!tokens.length) {
      this.logger?.info({ userId, staffId: staff?.id }, 'Notification recorded — no registered device');
      return { recorded: record.length, delivered: 0, devices: 0 };
    }

    const outcome = await this.#deliver(tokens, { title, body, type, data });
    await this.#markDelivered(record, outcome);

    this.logger?.info(
      { userId, staffId: staff?.id, devices: tokens.length, delivered: outcome.delivered },
      'Notification sent to one player'
    );

    return { recorded: record.length, delivered: outcome.delivered, devices: tokens.length };
  }

  /**
   * @legacy POST /firebase/send-bulk
   *
   * Push to every player in the caller's tree.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THIS IS THE ROUTE THAT WAS AN OPEN RELAY
   *
   * Unauthenticated, with the title and body from the request, reaching every
   * registered device on the platform — from the operator's own app, carrying
   * its icon and its name. Behind `config:write` here, scoped to the caller's
   * own tree rather than everyone, bounded, and audited.
   * ─────────────────────────────────────────────────────────────────────
   */
  async broadcast({ staff, title, body, type, data, channel = 'direct' }) {
    const visible = await this.#visibleUserIds(staff, this.#channelFor(channel, type));

    /**
     * OneSignal is addressed by PLAYER, so the broadcast names the caller's
     * own tree rather than a OneSignal segment. A segment would reach every
     * subscriber of the app — the same open relay this route was rebuilt to
     * close, just one hop further away.
     */
    const onesignal = await this.#oneSignal();
    if (onesignal) {
      const recipients = [...new Set(visible.map(String))];
      if (recipients.length > MAX_BROADCAST_DEVICES) {
        throw errors.BROADCAST_TOO_LARGE({ players: recipients.length, max: MAX_BROADCAST_DEVICES });
      }
      const record = await this.#record(recipients, { title, body, type, data, staff });
      const outcome = recipients.length
        ? await onesignal.sendToUsers(recipients, { title, body, type, data })
        : { accepted: 0, failures: [] };
      await this.#markDelivered(record, outcome);
      this.logger?.warn(
        { staffId: staff?.id, players: recipients.length, provider: 'onesignal', accepted: outcome.accepted },
        'BROADCAST sent'
      );
      return { players: recipients.length, devices: null, recorded: record.length, delivered: outcome.accepted, provider: 'onesignal' };
    }

    const tokens = await this.#tokensFor(visible);

    if (tokens.length > MAX_BROADCAST_DEVICES) {
      // A ceiling, so one request cannot fan out without limit. Legacy had
      // none — and no authentication in front of it either.
      throw errors.BROADCAST_TOO_LARGE({ devices: tokens.length, max: MAX_BROADCAST_DEVICES });
    }

    // Inbox rows for every player in scope — not only those with push tokens.
    const record = await this.#record(visible, { title, body, type, data, staff });

    const outcome = tokens.length
      ? await this.#deliver(tokens, { title, body, type, data })
      : { delivered: 0, failures: [] };

    await this.#markDelivered(record, outcome);

    this.logger?.warn(
      { staffId: staff?.id, players: visible.length, devices: tokens.length, delivered: outcome.delivered },
      'BROADCAST sent'
    );

    return {
      players: visible.length,
      devices: tokens.length,
      recorded: record.length,
      delivered: outcome.delivered,
    };
  }

  /**
   * One notification to one player about something that happened to them —
   * a deposit approved, a withdrawal paid, a VIP level-up.
   *
   * Called by user-service over the internal API (no staff, no tree check:
   * the caller is the service that just moved the player's money). The
   * `dedupeKey` names the EVENT, so a retried callback or a replayed hook
   * lands on the same row: `ON CONFLICT DO NOTHING` against the partial
   * unique index from migration 072. Only a NEW row is pushed to devices.
   *
   * The push is best effort and never fails the record.
   */
  async notifyPlayer({ userId, title, body, type, data, dedupeKey }) {
    /**
     * The operator's push template for this event (site admin → Push
     * notifications → Push templates). No template = the caller's own words,
     * which are the defaults. A template's copy is used for BOTH the bell row
     * and the push so the two never disagree; switching the event's push off
     * still writes the bell row.
     */
    const content = await this.#eventContent({ kind: type, title, body, data });
    const rowData = data == null && !content.imageUrl ? null : {
      ...(data ?? {}),
      ...(content.customised && content.link ? { link: content.link } : {}),
      ...(content.imageUrl ? { image: content.imageUrl } : {}),
      ...(content.customised ? (content.template ? { template: content.template } : { template: undefined }) : {}),
    };

    const [rows] = await this.models.UserNotifications.sequelize.query(
      `INSERT INTO user_notifications (user_id, title, body, type, additional_data, dedupe_key, created_at)
       VALUES (:userId, :title, :body, :type, CAST(:data AS JSONB), :dedupeKey, NOW())
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id`,
      {
        replacements: {
          userId,
          title: String(content.title).slice(0, 200),
          body: content.body ?? null,
          type: type ?? NOTIFICATION_TYPES.GENERAL,
          data: rowData == null ? null : JSON.stringify(rowData),
          dedupeKey: dedupeKey ?? null,
        },
      }
    );
    const id = rows?.[0]?.id ?? null;
    const { unread } = await this.unreadCount({ userId });
    if (!id) return { created: false, id: null, unread };

    try {
      const message = {
        title: content.title,
        body: content.body,
        type,
        data: { ...(data?.meta ? { meta: JSON.stringify(data.meta) } : {}), kind: type, ...(data?.link ? { link: String(data.link) } : {}) },
        ...(content.url ? { url: content.url } : {}),
        ...(content.imageUrl ? { imageUrl: content.imageUrl } : {}),
        ...(content.iconUrl ? { iconUrl: content.iconUrl } : {}),
        ...(dedupeKey ? { idempotencyKey: `event-${userId}-${dedupeKey}` } : {}),
      };
      const onesignal = content.push ? await this.#oneSignal() : null;
      if (onesignal) {
        await this.#markDelivered([id], await onesignal.sendToUsers([userId], message));
      } else if (content.push && this.push) {
        const tokens = await this.#tokensFor([userId]);
        if (tokens.length) await this.#markDelivered([id], await this.#deliver(tokens, message));
      }
    } catch (error) {
      this.logger?.warn({ err: error.message, userId: String(userId) }, 'Player notification recorded; push failed');
    }

    return { created: true, id, unread, pushed: content.push };
  }

  /** The push template for an event; any failure falls back to the caller's copy. */
  async #eventContent({ kind, title, body, data }) {
    const fallback = { customised: false, push: true, title, body, imageUrl: null, iconUrl: null, url: null, template: null };
    if (!this.models?.UserNotifications?.sequelize) return fallback;
    try {
      // Required here, not at the top: push.service requires this module's provider.
      const { PushService } = require('../push/push.service');
      this.pushTemplates ??= new PushService({ models: this.models, logger: this.logger, config: this.config, features: this.features });
      return await this.pushTemplates.eventContent({ kind, title, body, data });
    } catch (error) {
      this.logger?.warn({ err: error.message, kind }, 'Push template lookup failed; using the built-in copy');
      return fallback;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  A player's own
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /firebase/history/:userId */
  /**
   * `unreadOnly` is additive and defaults off, so every existing caller — the
   * internal route, the admin screens — is unaffected. It exists because the
   * player-facing panel has an "unread" tab and filtering a page of 50 in the
   * client would page over rows it then discards, reporting a total that does
   * not match what it shows.
   */
  async history({ userId, limit = 50, offset = 0, unreadOnly = false, types, excludeTypes }) {
    const { rows, count } = await this.models.UserNotifications.findAndCountAll({
      where: { user_id: userId, ...(unreadOnly ? { is_read: false } : {}), ...typeWhere(types, excludeTypes) },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        type: r.type,
        data: r.additional_data ?? null,
        read: Boolean(r.is_read),
        readAt: r.read_at ?? null,
        delivered: Boolean(r.delivered),
        createdAt: r.created_at,
      })),
    };
  }

  /** @legacy GET /firebase/unread-count/:userId */
  async unreadCount({ userId, excludeTypes, byType = false }) {
    const where = { user_id: userId, is_read: false, ...typeWhere(undefined, excludeTypes) };
    if (!byType) {
      const count = await this.models.UserNotifications.count({ where });
      return { unread: count };
    }
    /* `byType`: the player panel's tab badges. One grouped read, so the tabs
       and the bell can never disagree about the total. */
    const rows = await this.models.UserNotifications.findAll({
      where,
      attributes: ['type', [fn('COUNT', col('id')), 'n']],
      group: ['type'],
      raw: true,
    });
    const counts = {};
    let unread = 0;
    for (const r of rows) {
      const n = Number(r.n) || 0;
      counts[r.type] = n;
      unread += n;
    }
    return { unread, byType: counts };
  }

  /**
   * The staff reads of one player's notifications.
   *
   * `history` and `unreadCount` above are also what the PLAYER's own routes
   * call, with the id from their token. A staff caller names the player in the
   * URL, so the player has to be inside the caller's tree first — otherwise an
   * agent reads any player's inbox by changing a number. Out of tree is the
   * same 404 as a player that does not exist, like every other per-player
   * staff route.
   */
  // ══════════════════════════════════════════════════════════════════════
  //  What staff sent
  // ══════════════════════════════════════════════════════════════════════

  /** Direct Users tab: any type to direct users. Agent Users tab: general notifications only, to agent players. */
  #channelFor(channel, type) {
    if (channel !== 'agent') return 'direct';
    if ((type ?? NOTIFICATION_TYPES.GENERAL) !== NOTIFICATION_TYPES.GENERAL) throw errors.AGENT_GENERAL_ONLY({ type });
    return 'agent';
  }

  /** The Sent list of one tab: one row per staff send by the caller's tree, newest first. */
  async listSends({ staff, limit, offset, channel = 'direct' }) {
    const players = `(SELECT id FROM users WHERE parent_staff_id IS ${channel === 'agent' ? 'NOT ' : ''}NULL)`;
    const where = {
      send_id: { [Op.ne]: null },
      sent_by: await visibleStaffIds(this.models, staff.id, { logger: this.logger }),
      user_id: { [Op.in]: literal(players) },
    };
    const groups = await this.models.UserNotifications.findAll({
      where,
      attributes: [
        'send_id',
        [fn('MIN', col('title')), 'title'],
        [fn('MIN', col('body')), 'body'],
        [fn('MIN', col('type')), 'type'],
        [fn('MIN', col('sent_by')), 'sent_by'],
        [fn('MIN', col('created_at')), 'created_at'],
        [fn('COUNT', col('id')), 'players'],
        [fn('MIN', col('user_id')), 'user_id'],
      ],
      group: ['send_id'],
      order: [[fn('MIN', col('created_at')), 'DESC']],
      limit,
      offset,
      raw: true,
    });
    const total = await this.models.UserNotifications.count({ where, distinct: true, col: 'send_id' });
    return {
      total,
      rows: groups.map((g) => ({
        sendId: g.send_id,
        title: g.title,
        body: g.body,
        type: g.type,
        players: Number(g.players),
        // A one-user send names its player.
        userId: Number(g.players) === 1 ? g.user_id : null,
        sentBy: g.sent_by,
        sentAt: g.created_at,
      })),
    };
  }

  /** Edits the inbox copy of a send; a push already delivered cannot be recalled. */
  async updateSend({ staff, sendId, title, body }) {
    const where = await this.#sendWhere(staff, sendId);
    const changes = { title, ...(body !== undefined ? { body: body || null } : {}) };
    const [updated] = await this.models.UserNotifications.update(changes, { where });
    return { sendId, updated };
  }

  /** Removes a send from every player's inbox. */
  async deleteSend({ staff, sendId }) {
    const where = await this.#sendWhere(staff, sendId);
    const removed = await this.models.UserNotifications.destroy({ where });
    return { sendId, removed };
  }

  /** A send by the caller's tree, or 404. */
  async #sendWhere(staff, sendId) {
    const where = { send_id: sendId, sent_by: await visibleStaffIds(this.models, staff.id, { logger: this.logger }) };
    if (!(await this.models.UserNotifications.count({ where }))) throw errors.SEND_NOT_FOUND({ sendId });
    return where;
  }

  async staffHistory({ staff, userId, ...rest }) {
    await this.#assertPlayerVisible(staff, userId);
    return this.history({ userId, ...rest });
  }

  async staffUnreadCount({ staff, userId }) {
    await this.#assertPlayerVisible(staff, userId);
    return this.unreadCount({ userId });
  }

  /**
   * @legacy POST /firebase/mark-as-read
   *
   * Legacy took `userId` AND `notificationIds` from the body with no
   * authentication, so anyone could mark anyone's notifications read — which
   * is how an alert somebody needed to see disappears from their badge.
   */
  async markRead({ userId, notificationIds }) {
    const now = new Date();
    const [affected] = await this.models.UserNotifications.update(
      { is_read: true, read_at: now },
      {
        where: {
          user_id: userId,
          ...(notificationIds?.length ? { id: notificationIds } : {}),
          // Only the unread ones, so a re-read does not overwrite when they
          // FIRST saw it. Legacy had no timestamp at all.
          is_read: false,
        },
      }
    );
    return { marked: affected };
  }

  // ══════════════════════════════════════════════════════════════════════

  /** Write the history rows first — a push with no record is invisible. */
  async #record(userIds, { title, body, type, data, staff }) {
    if (!userIds.length) return [];
    const now = new Date();
    const sendId = crypto.randomUUID();
    const rows = await this.models.UserNotifications.bulkCreate(
      userIds.map((userId) => ({
        user_id: userId,
        title,
        body: body ?? null,
        type: type ?? NOTIFICATION_TYPES.GENERAL,
        additional_data: data ?? null,
        is_read: false,
        delivered: false,
        created_at: now,
        send_id: sendId,
        sent_by: staff?.id ?? null,
      })),
      { returning: true }
    );
    return rows.map((r) => r.id);
  }

  /**
   * `user_id -> {name, email}` for the ids given.
   *
   * Keyed on a STRING id: `user_id` is a BIGINT and arrives as a string from
   * one query and a number from the other depending on the driver, so a
   * numeric key silently misses.
   */
  async #ownersOf(userIds) {
    const ids = [...new Set(userIds.filter((id) => id !== null && id !== undefined))];
    if (!ids.length) return new Map();

    const users = await this.models.Users.findAll({
      where: { id: ids },
      attributes: ['id', 'name', 'email'],
      raw: true,
    });

    return new Map(users.map((u) => [String(u.id), { name: u.name, email: u.email }]));
  }

  async #tokensFor(userIds) {
    if (!userIds.length) return [];
    return this.models.UserFcmToken.findAll({
      where: { user_id: userIds, is_active: true },
      attributes: ['id', 'user_id', 'token'],
      raw: true,
    });
  }

  /**
   * Hand the tokens to the transport, in batches.
   *
   * A failure does not throw: the notification is already recorded, and the
   * caller wants to know how many landed rather than losing the whole send
   * because one device is stale.
   */
  async #deliver(tokens, message) {
    if (!this.push) {
      this.logger?.warn({ devices: tokens.length }, 'Push is not configured — notification recorded only');
      return { delivered: 0, failures: [], notConfigured: true };
    }

    let delivered = 0;
    const failures = [];

    for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
      const batch = tokens.slice(i, i + FCM_BATCH_SIZE);
      try {
        const result = await this.push.sendMulticast({
          tokens: batch.map((t) => t.token),
          notification: { title: message.title, body: message.body ?? '' },
          data: this.#stringifyData(message),
        });
        delivered += Number(result?.successCount ?? 0);

        /**
         * Deactivate tokens the provider says are dead.
         *
         * Firebase reports `registration-token-not-registered` for a device
         * that uninstalled. Left active, every future broadcast pays for them
         * again — legacy never read the per-token results at all.
         */
        const dead = (result?.responses ?? [])
          .map((r, index) => (r?.error?.code?.includes('not-registered') ? batch[index].token : null))
          .filter(Boolean);

        if (dead.length) {
          await this.models.UserFcmToken.update(
            { is_active: false, updated_at: new Date() },
            { where: { token: dead } }
          );
          this.logger?.info({ count: dead.length }, 'Deactivated push tokens the provider rejected');
        }
      } catch (error) {
        this.logger?.error({ err: error, batch: batch.length }, 'Push batch failed');
        failures.push(error.message);
      }
    }

    return { delivered, failures };
  }

  /** The OneSignal transport if this site has it switched on with keys, else null. */
  async #oneSignal() {
    if (!this.features) return null;
    try {
      return await this.features.pushProvider();
    } catch (error) {
      // A misconfigured integration must not stop the notification being recorded.
      this.logger?.error({ err: error.message }, 'Could not build the push provider — recording only');
      return null;
    }
  }

  async #markDelivered(ids, outcome) {
    if (!ids.length) return;
    await this.models.UserNotifications.update(
      {
        delivered: Number(outcome.delivered ?? outcome.accepted ?? 0) > 0,
        delivery_error: outcome.failures?.length ? outcome.failures.join('; ').slice(0, 500) : null,
      },
      { where: { id: ids } }
    );
  }

  /** FCM data values must all be strings. */
  #stringifyData({ type, data }) {
    const out = { type: String(type ?? NOTIFICATION_TYPES.GENERAL) };
    for (const [key, value] of Object.entries(data ?? {})) {
      out[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return out;
  }

  /** `channel` (devices list ka Direct Users | Agent Users tab): direct = koi parent nahi, agent = agent ke neeche. */
  async #visibleUserIds(staff, channel) {
    const staffIds = await visibleStaffIds(this.models, staff.id, { logger: this.logger });
    const includeUnassigned = staffIds.map(Number).includes(1);
    const tree = includeUnassigned
      ? { [Op.or]: [{ parent_staff_id: staffIds }, { parent_staff_id: null, is_demo: false }] }
      : { parent_staff_id: staffIds };
    const tab = channel === 'direct' ? { parent_staff_id: null } : channel === 'agent' ? { parent_staff_id: { [Op.ne]: null } } : null;

    const users = await this.models.Users.findAll({
      where: tab ? { [Op.and]: [tree, tab] } : tree,
      attributes: ['id'],
      raw: true,
    });
    return users.map((u) => u.id);
  }

  /** One player, checked with one query rather than loading the whole tree. */
  async #assertPlayerVisible(staff, userId) {
    if (!staff?.id) throw errors.NOT_IN_YOUR_TREE({ userId });

    const staffIds = await visibleStaffIds(this.models, staff.id, { logger: this.logger });
    const includeUnassigned = staffIds.map(Number).includes(1);

    const player = await this.models.Users.findOne({
      where: {
        id: userId,
        ...(includeUnassigned
          ? { [Op.or]: [{ parent_staff_id: staffIds }, { parent_staff_id: null, is_demo: false }] }
          : { parent_staff_id: staffIds }),
      },
      attributes: ['id'],
      raw: true,
    });
    if (!player) throw errors.NOT_IN_YOUR_TREE({ userId });
  }

  #assertVisible(visible, userId) {
    if (!visible.map(String).includes(String(userId))) throw errors.NOT_IN_YOUR_TREE({ userId });
    return Number(userId);
  }

  /** Identifiable in a support conversation, not usable to send with. */
  #maskToken(token) {
    const value = String(token ?? '');
    if (value.length <= 12) return '***';
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }
}

module.exports = { NotificationsService };
