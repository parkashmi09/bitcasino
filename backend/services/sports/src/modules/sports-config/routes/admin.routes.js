'use strict';

const { Router } = require('express');

const { PERMISSIONS } = require('@ibitplay/auth');

const { lazy } = require('../../../lib/mssports');

/**
 * mssports `api/settlementStatement.api.js` → `sportsLockRouter` + `sportsAdminRouter`, route for
 * route. Mounted at `/api/v1/admin/sports/config` (staff token, then mssports' own checks).
 *
 *  GET  /sports-lock/get/:targetId     🔒      sport locks of a user/staff
 *  POST /sports-lock/update            🔒      set sport lock
 *  GET  /betlock/market-locks/:event_id     🔒 backoffice   market locks of an event
 *  POST /betlock/toggle-market-lock         🔒 backoffice 🔑 lock/unlock one market
 *  POST /betlock/bulk-toggle-market-lock    🔒 backoffice 🔑 lock/unlock many markets
 *  GET|POST|DELETE /betting-config/buffer/sports (+ POST /bulk)          👑 bet buffer seconds
 *  GET  /betting-config/bet-limits/inplay                                👑 live events for limits
 *  GET  /betting-config/bet-limits/event/:event_id                       👑 markets of an event
 *  POST /betting-config/bet-limits/event, DELETE .../event/:id           👑 per-market min/max
 *  GET|POST|DELETE /betting-config/max-odds/sports                       👑 max odds caps
 *  GET|PUT /betting-config/auto-void, GET /auto-void/tracker             👑 auto-void config
 *  GET|POST /betting-config/auto-void/links, PUT|DELETE .../links/:id    👑 result source links
 *  GET|PUT /betting-config/virtual-limits                                👑 virtual league limits
 *  GET|POST|DELETE /commission-config/sports (+ POST /bulk)              👑 win commission
 */
module.exports = function adminRoutes({ auth }) {
  // Platform permissions first, so an executive does only what it was granted (user, 2026-10-17):
  // locks are users:lock (the agent tree holds it), global settings sports:manage.
  const canRead = auth.requirePermission(PERMISSIONS.USERS_READ);
  const canLock = auth.requirePermission(PERMISSIONS.USERS_LOCK);
  const canManage = auth.requirePermission(PERMISSIONS.SPORTS_MANAGE);
  const authMiddleware = lazy((m) => m.authMiddleware);
  const requireOwner = lazy((m) => m.requireOwner);
  const requireBackoffice = lazy((m) => m.requireBackoffice);
  const requireTxnCode = lazy((m) => m.verifyTransactionPasswordAs(m.MESSAGES.ADMIN.TXN.MASTER_NOT_VALID));
  const SportsLock = (name) => lazy((m) => m.SportsLockController[name]);
  const BettingConfig = (name) => lazy((m) => m.AdminBettingConfigController[name]);
  const Commission = (name) => lazy((m) => m.CommissionConfigController[name]);
  const marketLocks = (name) => lazy((m) => m[name]);

  const router = Router();

  // ── /sports-lock (TENEXCH: its own router, `router.use(authMiddleware)`) ──
  router.get('/sports-lock/get/:targetId', canRead, authMiddleware, SportsLock('getSportsLocks'));
  router.post('/sports-lock/update', canLock, authMiddleware, SportsLock('updateSportsLock'));

  // ── bet locks, betting config, commission ───────────────────────────

  router.get('/betlock/market-locks/:event_id', canRead, authMiddleware, requireBackoffice, marketLocks('getMarketLockChildren'));
  router.post('/betlock/toggle-market-lock', canLock, authMiddleware, requireBackoffice, requireTxnCode, marketLocks('toggleMarketLock'));
  router.post('/betlock/bulk-toggle-market-lock', canLock, authMiddleware, requireBackoffice, requireTxnCode, marketLocks('bulkToggleMarketLock'));

  router.get('/betting-config/buffer/sports', canManage, authMiddleware, requireOwner, BettingConfig('getSportsBuffers'));
  router.post('/betting-config/buffer/sports', canManage, authMiddleware, requireOwner, BettingConfig('saveSportsBuffer'));
  router.post('/betting-config/buffer/sports/bulk', canManage, authMiddleware, requireOwner, BettingConfig('saveSportsBufferBulk'));
  router.delete('/betting-config/buffer/sports', canManage, authMiddleware, requireOwner, BettingConfig('resetSportsBuffer'));
  // 'inplay' is declared BEFORE the ':event_id' style routes so Express can't match it as an id.
  router.get('/betting-config/bet-limits/inplay', canManage, authMiddleware, requireOwner, BettingConfig('getInplayEvents'));
  router.get('/betting-config/bet-limits/event/:event_id', canManage, authMiddleware, requireOwner, BettingConfig('getEventMarkets'));
  router.post('/betting-config/bet-limits/event', canManage, authMiddleware, requireOwner, BettingConfig('saveEventLimit'));
  router.delete('/betting-config/bet-limits/event/:id', canManage, authMiddleware, requireOwner, BettingConfig('deleteEventLimit'));
  router.get('/betting-config/max-odds/sports', canManage, authMiddleware, requireOwner, BettingConfig('getSportsMaxOdds'));
  router.post('/betting-config/max-odds/sports', canManage, authMiddleware, requireOwner, BettingConfig('saveSportsMaxOdds'));
  router.delete('/betting-config/max-odds/sports', canManage, authMiddleware, requireOwner, BettingConfig('resetSportsMaxOdds'));
  router.get('/betting-config/auto-void', canManage, authMiddleware, requireOwner, BettingConfig('getAutoVoid'));
  router.put('/betting-config/auto-void', canManage, authMiddleware, requireOwner, BettingConfig('saveAutoVoid'));
  router.get('/betting-config/auto-void/tracker', canManage, authMiddleware, requireOwner, BettingConfig('getAutoVoidTracker'));
  router.get('/betting-config/auto-void/links', canManage, authMiddleware, requireOwner, BettingConfig('listResultLinks'));
  router.post('/betting-config/auto-void/links', canManage, authMiddleware, requireOwner, BettingConfig('createResultLink'));
  router.put('/betting-config/auto-void/links/:id', canManage, authMiddleware, requireOwner, BettingConfig('updateResultLink'));
  router.delete('/betting-config/auto-void/links/:id', canManage, authMiddleware, requireOwner, BettingConfig('deleteResultLink'));
  router.get('/betting-config/virtual-limits', canManage, authMiddleware, requireOwner, BettingConfig('getVirtualLimits'));
  router.put('/betting-config/virtual-limits', canManage, authMiddleware, requireOwner, BettingConfig('saveVirtualLimits'));

  router.get('/commission-config/sports', canManage, authMiddleware, requireOwner, Commission('getSportsCommission'));
  router.post('/commission-config/sports', canManage, authMiddleware, requireOwner, Commission('saveSportsCommission'));
  router.post('/commission-config/sports/bulk', canManage, authMiddleware, requireOwner, Commission('saveSportsCommissionBulk'));
  router.delete('/commission-config/sports', canManage, authMiddleware, requireOwner, Commission('resetSportsCommission'));

  router.authorizationReviewed =
    'mssports authorizes each route itself: authMiddleware, then requireOwner (the platform Super Admin) or requireBackoffice + the transaction password on market-lock writes. The /sports-lock routes check only that the caller is signed in (staff, here) and that only the owner touches owner locks: there is no downline check, as in TENEXCH';
  return router;
};
