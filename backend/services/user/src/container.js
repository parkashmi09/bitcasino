'use strict';

const { createLogger, ServiceClient, Mailer, resolveInternalKey, configureEntitlements, configureCurrencyRegistry, sitePolicy } = require('@ibitplay/common');
const { createAuthMiddleware, configureAgentPlayers } = require('@ibitplay/auth');
const db = require('@ibitplay/db');

const config = require('./config');
const { configureNotifier } = require('./modules/notifications/notifyPlayer');

/**
 * The user-service container.
 *
 * Assembled once at boot and handed to every module's router factory. Modules
 * never require the database or an upstream client directly — that is what lets
 * the same module run against a fake container in a test, and against an
 * in-process dispatcher in monolith mode.
 */
async function createContainer({ logger: injectedLogger } = {}) {
  const logger =
    injectedLogger ||
    createLogger({ name: config.SERVICE_NAME, level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

  const connection = await db.connect({ config, logger, service: 'user-service' });

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
    admin: new ServiceClient({
      name: 'admin-service',
      baseUrl: config.ADMIN_SERVICE_URL,
      internalKey: ourInternalKey,
      callerName: config.SERVICE_NAME,
      timeoutMs: config.SERVICE_TIMEOUT_MS,
      retries: config.SERVICE_RETRIES,
      logger,
    }),
    casino: new ServiceClient({
      name: 'casino-service',
      baseUrl: config.CASINO_SERVICE_URL,
      internalKey: ourInternalKey,
      callerName: config.SERVICE_NAME,
      timeoutMs: config.SERVICE_TIMEOUT_MS,
      retries: config.SERVICE_RETRIES,
      logger,
    }),
    sports: new ServiceClient({
      name: 'sports-service',
      baseUrl: config.SPORTS_SERVICE_URL,
      internalKey: ourInternalKey,
      callerName: config.SERVICE_NAME,
      timeoutMs: config.SERVICE_TIMEOUT_MS,
      retries: config.SERVICE_RETRIES,
      logger,
    }),
  };

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
   * Outbound email.
   *
   * One pooled transport for the process. Legacy built a fresh one per request
   * with the SMTP password in the source — see `packages/common/src/mailer.js`.
   */
  const mailer = new Mailer({ config, logger });

  // The owner's plan, asked of admin-service and cached 15 s — see
  // `packages/common/src/entitlements.js`.
  configureEntitlements({ clients, logger, config });
  // The coin registry (names, networks, switches), asked of admin-service and
  // cached 5 s — see `packages/common/src/currencyRegistry.js`.
  configureCurrencyRegistry({ clients, logger, config });

  // Players owned by the agent tree (staff levels 4–6) get no promotions, vault
  // or deposits — `packages/auth/src/agentPlayers.js`. Owner and staff level are
  // each cached briefly, so a guarded route is not a lookup per request.
  const agentPlayers = configureAgentPlayers({
    loadOwnerStaffId: async (userId) => {
      const row = await connection.models.Users.findByPk(userId, { attributes: ['parent_staff_id'], raw: true });
      return row?.parent_staff_id ?? null;
    },
    loadIsDemo: async (userId) => {
      const row = await connection.models.Users.findByPk(userId, { attributes: ['is_demo'], raw: true });
      return Boolean(row?.is_demo);
    },
    loadStaff: (staffId) => clients.admin.get(`/internal/admin/staff-directory/staff/${staffId}`),
    // The owner's business model, read live: on b2b no player gets promotions (agentPlayers.js).
    loadBusinessModel: () => sitePolicy.readPolicy(connection.models, 'business_model'),
  });

  const container = {
    config,
    logger,
    db: connection,
    models: connection.models,
    clients,
    mailer,
    auth,
    agentPlayers,
    async close() {
      await connection.close();
    },
  };

  /* Player notifications (deposit approved, VIP level-up, …) go through this
     container; `io` is read lazily, once `attachSockets` sets it. */
  configureNotifier(container);

  return container;
}

module.exports = { createContainer };
