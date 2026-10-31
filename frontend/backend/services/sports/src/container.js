'use strict';

const { createLogger, ServiceClient, WalletClient , createCache, resolveInternalKey } = require('@ibitplay/common');
const { createAuthMiddleware } = require('@ibitplay/auth');
const db = require('@ibitplay/db');

const config = require('./config');

/**
 * The service container.
 *
 * Everything a module needs is assembled here once and handed to the router
 * factories. Modules never require the database or a client directly — that is
 * what makes a module testable against a fake container, and what lets the same
 * module run inside the monolith where `clients.user` is an in-process
 * dispatcher rather than an HTTP client.
 */
async function createContainer({ logger: injectedLogger } = {}) {
  const logger = injectedLogger || createLogger({ name: config.SERVICE_NAME, level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

  const connection = await db.connect({ config, logger, service: 'sports-service' });

  // ── Upstreams ────────────────────────────────────────────────────────
  /**
   * The key THIS service presents when calling another.
   *
   * Its own when configured, which is how the receiver identifies us and
   * how audit rows get a caller name that is a fact rather than a header
   * we wrote. Falls back to the shared key so an unmigrated deployment is
   * unaffected.
   */
  const ourInternalKey = resolveInternalKey(config, config.SERVICE_NAME);

  const clients = {
    /** All money movement. sports-service never writes a balance itself. */
    user: new ServiceClient({
      name: 'user-service',
      baseUrl: config.USER_SERVICE_URL,
      internalKey: ourInternalKey,
      callerName: config.SERVICE_NAME,
      timeoutMs: config.SERVICE_TIMEOUT_MS,
      retries: config.SERVICE_RETRIES,
      logger,
    }),
    /** Staff identity, permissions and the audit trail. */
    admin: new ServiceClient({
      name: 'admin-service',
      baseUrl: config.ADMIN_SERVICE_URL,
      internalKey: ourInternalKey,
      callerName: config.SERVICE_NAME,
      timeoutMs: config.SERVICE_TIMEOUT_MS,
      retries: config.SERVICE_RETRIES,
      logger,
    }),
  };

  // ── Money ────────────────────────────────────────────────────────────
  // The ONLY way this service changes a balance. It never writes `credits`
  // itself — the row locking, ledger writes and idempotency rules live in
  // user-service, once, so there is one implementation to audit.
  const wallet = new WalletClient({ client: clients.user, service: config.SERVICE_NAME, logger });

  // ── Auth ─────────────────────────────────────────────────────────────
  // `loadUser` reads the local core domain (sports-service already loads it for
  // exposures). `loadStaff` cannot: the staff tables belong to admin-service, so
  // it resolves over the internal API. That means a demoted or locked staff
  // account loses access here immediately, rather than when its token expires.
  const auth = createAuthMiddleware({
    config,
    loadUser: async (userId) => {
      const user = await connection.models.Users.findByPk(userId, {
        attributes: ['id', 'status', 'is_locked', 'system_locked', 'bet_status'],
        raw: true,
      });
      return user || null;
    },
    loadStaff: async (staffId, executiveId) =>
      clients.admin.get(`/internal/admin/staff-directory/staff/${staffId}`, {
        query: executiveId ? { executiveId } : undefined,
      }),
  });

  /**
   * The shared cache. Redis when configured; a heap Map with a loud warning
   * otherwise — see `packages/common/src/cache.js`.
   *
   * The feed jobs WRITE it and the feed service READS it, in different
   * processes, which is the whole reason it is not the client's own Map.
   */
  const cache = createCache({ config, logger, role: 'sports' });

  return {
    config,
    logger,
    cache,
    db: connection,
    models: connection.models,
    clients,
    wallet,
    auth,
    async close() {
      await cache.close();
      await connection.close();
    },
  };
}

module.exports = { createContainer };
