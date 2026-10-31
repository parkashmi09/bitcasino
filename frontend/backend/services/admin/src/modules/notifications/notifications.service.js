'use strict';

const { Op, fn, col } = require('sequelize');

const errors = require('./notifications.errors');
const { NOTIFICATION_TYPES, MAX_BROADCAST_DEVICES, FCM_BATCH_SIZE } = require('./notifications.constants');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * Sending a push, and the record of what was sent.
 *
 * The record is written first and the push attempted second. A notification
 * that reached a device but has no row is invisible to support; a row whose
 * push failed is at least answerable. Legacy wrote the row and the push in the
 * same statement path and recorded neither outcome.
 */
class NotificationsService {
  constructor({ models, db, logger, config, push }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
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
  async listDevices({ staff, userId, activeOnly = true, limit = 50, offset = 0 }) {
    const visible = await this.#visibleUserIds(staff);
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
  async sendToUser({ staff, userId, title, body, type, data }) {
    const visible = await this.#visibleUserIds(staff);
    this.#assertVisible(visible, userId);

    const tokens = await this.#tokensFor([userId]);
    const record = await this.#record([userId], { title, body, type, data });

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
  async broadcast({ staff, title, body, type, data }) {
    const visible = await this.#visibleUserIds(staff);
    const tokens = await this.#tokensFor(visible);

    if (tokens.length > MAX_BROADCAST_DEVICES) {
      // A ceiling, so one request cannot fan out without limit. Legacy had
      // none — and no authentication in front of it either.
      throw errors.BROADCAST_TOO_LARGE({ devices: tokens.length, max: MAX_BROADCAST_DEVICES });
    }

    const recipients = [...new Set(tokens.map((t) => String(t.user_id)))];
    const record = await this.#record(recipients, { title, body, type, data });

    const outcome = tokens.length
      ? await this.#deliver(tokens, { title, body, type, data })
      : { delivered: 0, failures: [] };

    await this.#markDelivered(record, outcome);

    this.logger?.warn(
      { staffId: staff?.id, players: recipients.length, devices: tokens.length, delivered: outcome.delivered },
      'BROADCAST sent'
    );

    return {
      players: recipients.length,
      devices: tokens.length,
      recorded: record.length,
      delivered: outcome.delivered,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  A player's own
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /firebase/history/:userId */
  async history({ userId, limit = 50, offset = 0 }) {
    const { rows, count } = await this.models.UserNotifications.findAndCountAll({
      where: { user_id: userId },
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
  async unreadCount({ userId }) {
    const count = await this.models.UserNotifications.count({
      where: { user_id: userId, is_read: false },
    });
    return { unread: count };
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
  async #record(userIds, { title, body, type, data }) {
    if (!userIds.length) return [];
    const now = new Date();
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

  async #markDelivered(ids, outcome) {
    if (!ids.length) return;
    await this.models.UserNotifications.update(
      {
        delivered: outcome.delivered > 0,
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

  async #visibleUserIds(staff) {
    const staffIds = await descendantIds(this.models, staff.id, { logger: this.logger });
    const includeUnassigned = staffIds.map(Number).includes(1);

    const users = await this.models.Users.findAll({
      where: includeUnassigned
        ? { [Op.or]: [{ parent_staff_id: staffIds }, { parent_staff_id: null }] }
        : { parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });
    return users.map((u) => u.id);
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
