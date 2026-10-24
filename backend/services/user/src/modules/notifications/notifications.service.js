'use strict';

const { isAgentPlayer } = require('@ibitplay/auth');
const { filterFor, categoryOf, AGENT_HIDDEN_TYPES } = require('./categories');

const BASE = '/internal/admin/notifications';
const csv = (list) => (list?.length ? list.join(',') : undefined);

/**
 * The player's half of notifications, over admin-service's internal routes.
 *
 * Every method here takes the userId from the CALLER — the controller passes
 * `req.user.id`, which the auth middleware put there — and never from the
 * body. Legacy's versions of these took `userId` from the request with no
 * authentication at all, which is why the internal routes' own comment calls
 * that out: anyone could mark anyone's notifications read.
 */
class NotificationsService {
  constructor(deps) {
    const { clients, logger } = deps;
    this.clients = clients;
    this.logger = logger;
  }

  /**
   * A page of this player's notifications.
   *
   * The internal route answers `response.paginated`, so the body is
   * `{ data, meta }` rather than a bare array — passed through unchanged so a
   * client can page without a second call to learn the total.
   */
  async list({ userId, limit, offset, unreadOnly, category = 'all' }) {
    const filter = filterFor(category, { agentPlayer: await this.#agentPlayer(userId) });
    // A tab the player may not see (promotions for an agent-tree player): empty, not an error.
    if (!filter) return { rows: [], total: 0, limit, offset };
    return this.clients.admin.get(`${BASE}/history`, {
      query: {
        userId: String(userId),
        limit,
        offset,
        unreadOnly,
        types: csv(filter.types),
        excludeTypes: csv(filter.excludeTypes),
      },
    });
  }

  /**
   * The badge, and the panel's tab badges (`byCategory`). An agent-tree
   * player's promotions are left out of both, so the bell never counts a row
   * the panel will not show.
   */
  async unreadCount({ userId }) {
    const agentPlayer = await this.#agentPlayer(userId);
    const raw = await this.clients.admin.get(`${BASE}/unread`, {
      query: {
        userId: String(userId),
        byType: 'true',
        excludeTypes: agentPlayer ? csv(AGENT_HIDDEN_TYPES) : undefined,
      },
    });
    const body = raw?.data ?? raw ?? {};
    const byCategory = { system: 0, transactions: 0, promotions: 0 };
    for (const [type, n] of Object.entries(body.byType ?? {})) byCategory[categoryOf(type)] += Number(n) || 0;
    return { unread: Number(body.unread ?? 0), byCategory };
  }

  /** "Not an agent player" only when the resolver is unconfigured (a unit test); a real lookup error throws. */
  async #agentPlayer(userId) {
    return isAgentPlayer(userId);
  }

  /**
   * Mark some or all of them read.
   *
   * `notificationIds` omitted means EVERY unread one, which is `markRead`'s
   * own behaviour on the other side (`...(notificationIds?.length ? { id:
   * notificationIds } : {})`) rather than something invented here — so
   * "read all" needs no second endpoint on admin-service and none was added.
   * It only ever touches rows that are still unread, so a re-read cannot
   * overwrite when the player FIRST saw one.
   */
  async markRead({ userId, notificationIds }) {
    return this.clients.admin.post(`${BASE}/read`, {
      userId: String(userId),
      ...(notificationIds?.length ? { notificationIds } : {}),
    });
  }
}

module.exports = { NotificationsService };
