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
module.exports = function adminRoutes({ auth, clients, models }) {
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

  /* A lock's target must sit in the caller's own tree (the same staff scope every admin read
     uses): TENEXCH checked only OWNER targets, so any agent holding users:lock could lock a rival
     master's whole downline or lift a lock its upline set. A staff member never changes their own
     lock; a player with no parent belongs to the Super Admin (docs/SECURITY-CHECKLIST.md). */
  const notInTree = (res) => res.status(403).json({ success: false, message: 'Not in your tree' });
  // Each target is { type: 'USER' | 'STAFF', id }; write refuses the caller's own staff lock.
  const allInTree = async (staff, targets, write) => {
    if (!staff || targets.length === 0) return false;
    if (!targets.every((t) => Number.isInteger(t.id) && t.id > 0)) return false;
    const scope = await clients.admin.get(`/internal/admin/staff-directory/staff/${staff.id}/descendants`);
    const ids = (scope?.ids ?? scope?.data?.ids ?? []).map(Number);
    const top = Number(staff.level) === 1 || Number(staff.parentLevel) === 1;
    for (const { type, id } of targets) {
      if (type === 'USER') {
        const player = await models.Users.findByPk(id, { attributes: ['parent_staff_id'], raw: true });
        if (!player || !(player.parent_staff_id == null ? top : ids.includes(Number(player.parent_staff_id)))) return false;
      } else if (type !== 'STAFF' || !ids.includes(id) || (write && id === Number(staff.id))) {
        return false;
      }
    }
    return true;
  };
  const lockScope = async (req, res, next) => {
    try {
      const type = req.body?.targetType ?? req.query?.type;
      if (type === 'OWNER') return next(); // the controller allows the owner only
      const target = { type: type === 'USER' ? 'USER' : 'STAFF', id: Number(req.body?.targetId ?? req.params?.targetId) };
      return (await allInTree(req.staff, [target], req.method !== 'GET')) ? next() : notInTree(res);
    } catch (error) {
      return next(error);
    }
  };
  // The market-lock toggles (single and bulk) name accounts as { account_id, account_type: 'user' | 'staff' }.
  // Single checks the body's own account_id (what the controller acts on), bulk every accounts[] entry.
  const marketLockScope = (bulk) => async (req, res, next) => {
    try {
      const accounts = bulk ? (Array.isArray(req.body?.accounts) ? req.body.accounts : []) : [req.body ?? {}];
      const targets = accounts.map((a) => ({ type: a?.account_type === 'user' ? 'USER' : a?.account_type === 'staff' ? 'STAFF' : null, id: Number(a?.account_id) }));
      return (await allInTree(req.staff, targets, true)) ? next() : notInTree(res);
    } catch (error) {
      return next(error);
    }
  };

  // ── /sports-lock (TENEXCH: its own router, `router.use(authMiddleware)`) ──
  router.get('/sports-lock/get/:targetId', canRead, lockScope, authMiddleware, SportsLock('getSportsLocks'));
  router.post('/sports-lock/update', canLock, lockScope, authMiddleware, SportsLock('updateSportsLock'));

  // ── bet locks, betting config, commission ───────────────────────────

  router.get('/betlock/market-locks/:event_id', canRead, authMiddleware, requireBackoffice, marketLocks('getMarketLockChildren'));
  router.post('/betlock/toggle-market-lock', canLock, marketLockScope(false), authMiddleware, requireBackoffice, requireTxnCode, marketLocks('toggleMarketLock'));
  router.post('/betlock/bulk-toggle-market-lock', canLock, marketLockScope(true), authMiddleware, requireBackoffice, requireTxnCode, marketLocks('bulkToggleMarketLock'));

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
    'mssports authorizes each route itself: authMiddleware, then requireOwner (the platform Super Admin) or requireBackoffice + the transaction password on market-lock writes. Every lock route (/sports-lock and the market-lock toggles) first checks that each target is in the caller\'s own tree (lockScope / marketLockScope); only the owner touches owner locks';
  return router;
};
