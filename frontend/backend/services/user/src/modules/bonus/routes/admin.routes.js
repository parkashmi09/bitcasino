'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../bonus.validators');
const { BonusService } = require('../bonus.service');
const { createControllers } = require('../controllers');

/**
 * Bonus administration.
 *
 * Issuing a redeem code and adjusting a player's pending bonus figures are both
 * audited. Neither moves money at the moment it happens — which is exactly why
 * they need a record: the payment lands later, on a claim, and without an audit
 * row there is nothing connecting it to whoever authorised it.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new BonusService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);
  const audit = (action, describe) => withActivity({ action, describe });

  router.get('/records', canRead, validate(v.listRecords), ctrl.listRecords);
  router.get('/games', canRead, validate(v.listRecords), ctrl.listBonusGames);
  router.get('/events', canRead, validate(v.listRecords), ctrl.listEvents);
  router.get('/awards', canRead, validate(v.listAwards), ctrl.listAwards);
  router.get('/users', canRead, validate(v.listRecords), ctrl.listUserIds);
  router.get('/codes', canRead, validate(v.listCodes), ctrl.listCodes);
  router.get('/users/:userId', canRead, validate(v.userParam), ctrl.inspect);

  router.post(
    '/records',
    canWrite,
    validate(v.createRecord),
    audit('bonus.record.create', (req) => ({ targetType: 'USER', targetId: req.body.userId })),
    ctrl.createRecord
  );

  router.put(
    '/records',
    canWrite,
    validate(v.updateRecord),
    audit('bonus.record.update', (req) => ({
      targetType: 'USER', targetId: req.body.userId,
      details: { daily: req.body.daily, weekly: req.body.weekly, monthly: req.body.monthly },
    })),
    ctrl.updateRecord
  );

  router.delete(
    '/records',
    canWrite,
    validate(v.deleteRecord),
    audit('bonus.record.delete', (req) => ({ targetType: 'USER', targetId: req.body.userId })),
    ctrl.deleteRecord
  );

  // ── Per-game counters ─────────────────────────────────────────────────

  router.post(
    '/games',
    canWrite,
    validate(v.createBonusGame),
    audit('bonus.game.create', (req) => ({ targetType: 'USER', targetId: req.body.userId })),
    ctrl.createBonusGame
  );

  /**
   * Granting bonus requires `wallet:credit`, not `config:write`.
   *
   * The legacy equivalent added the same six numbers to a counter row AND to
   * `credits.bjb` — it mints balance. Gating that on a configuration permission
   * would let anyone who can edit a setting pay out money instead. It is priced
   * as what it is.
   *
   * Legacy's gate was `checkRole('user','admin')`: a static `role-key` header
   * looked up in `roles_keys`, one key per role shared by every client. The
   * player-tier key was enough, and `userid` came from the body.
   */
  router.put(
    '/games',
    auth.requirePermission(PERMISSIONS.WALLET_CREDIT),
    validate(v.grantBonusGame),
    audit('bonus.game.grant', (req) => ({
      targetType: 'USER',
      targetId: req.body.userId,
      details: { idempotencyKey: req.body.idempotencyKey, note: req.body.note },
    })),
    ctrl.grantBonusGame
  );

  router.delete(
    '/games',
    canWrite,
    validate(v.deleteBonusGame),
    audit('bonus.game.delete', (req) => ({ targetType: 'USER', targetId: req.body.userId })),
    ctrl.deleteBonusGame
  );

  // ── The event log ─────────────────────────────────────────────────────

  router.post(
    '/events',
    canWrite,
    validate(v.createEvent),
    audit('bonus.event.create', (req) => ({
      targetType: 'USER', targetId: req.body.userId,
      details: { event: req.body.event, amount: req.body.amount },
    })),
    ctrl.createEvent
  );

  /**
   * Addressed by row id.
   *
   * Legacy's `PUT /bonus/bonushistory` had no id to use — the table has no
   * primary key — so it updated `WHERE userid = $3` and set every one of that
   * player's log rows to the same event and amount. Migration 020 adds the key.
   */
  router.put(
    '/events/:id',
    canWrite,
    validate(v.updateEvent),
    audit('bonus.event.update', (req) => ({
      targetType: 'BONUS_EVENT', targetId: req.params.id, details: req.body,
    })),
    ctrl.updateEvent
  );

  router.delete(
    '/events/:id',
    canWrite,
    validate(v.eventParam),
    audit('bonus.event.delete', (req) => ({ targetType: 'BONUS_EVENT', targetId: req.params.id })),
    ctrl.deleteEvent
  );

  router.get('/dashboard', canRead, validate(v.dashboard), ctrl.dashboard);

  router.post(
    '/codes',
    canWrite,
    validate(v.createCode),
    audit('bonus.code.create', (req) => ({
      targetType: 'REDEEM_CODE', targetId: req.body.code,
      details: { userId: req.body.userId, amount: req.body.amount },
    })),
    ctrl.createCode
  );

  return router;
};
