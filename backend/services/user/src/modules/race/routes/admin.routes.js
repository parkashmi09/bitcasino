'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder, noBody } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../race.validators');
const { RaceService } = require('../race.service');
const { createControllers } = require('../controllers');

/**
 * Race administration.
 *
 * Every write is audited, because the configuration IS the promotion: the
 * multipliers decide who wins and the pool decides what that is worth. Someone
 * who can change them while a race is running can change its outcome, and the
 * audit row is the only record that it happened.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new RaceService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  // Promotions are house business: SUPER_MASTER / MASTER / AGENT (and their
  // executives) are refused every route below — PROMOTIONS_NOT_FOR_AGENTS.
  router.use(denyAgentTree());
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  const audit = (action, describe) => withActivity({ action, describe });

  // ── Reads ───────────────────────────────────────────────────────────
  router.get('/races', canRead, validate(v.adminListing), ctrl.listRaces);
  router.get('/rewards', canRead, validate(v.adminListing), ctrl.listRewards);
  router.get('/boats', canRead, ctrl.listBoats);
  router.get('/config/:type', canRead, validate(v.typeParam), ctrl.getConfig);
  router.get('/leaderboard/:type', canRead, validate(v.typeParam), ctrl.adminLeaderboard);

  // ── Configuration ───────────────────────────────────────────────────
  router.put(
    '/config/:type',
    canWrite,
    validate(v.updateConfig),
    audit('race.config', (req) => ({
      targetType: 'RACE_CONFIG',
      targetId: req.params.type,
      details: req.body,
    })),
    ctrl.updateConfig
  );

  /**
   * Settle a race by hand.
   *
   * `config:write` rather than a read grant: this writes the prizes and closes
   * the window, and re-running it on a race that has already settled is
   * harmless only because the unique constraint makes it so.
   */
  router.post(
    '/races/:id/settle',
    noBody(),
    canWrite,
    audit('race.settle', (req) => ({ targetType: 'RACE', targetId: req.params.id })),
    ctrl.settle
  );

  /** Close an open race with no prizes. `config:write`, audited with the reason. */
  router.post(
    '/races/:id/cancel',
    canWrite,
    validate(v.cancel),
    audit('race.cancel', (req) => ({ targetType: 'RACE', targetId: req.params.id, details: req.body })),
    ctrl.cancel
  );

  /**
   * Open a test race with a staff-chosen window (e.g. the next 10 minutes), so daily/weekly
   * payouts and booked seats can be tried without waiting for midnight or Monday. It settles
   * like any race: End & pay, or the roll job once it has ended.
   */
  router.post(
    '/races/test',
    canWrite,
    validate(v.testRace),
    audit('race.test', (req) => ({ targetType: 'RACE', targetId: req.body.type, details: req.body })),
    ctrl.startTestRace
  );

  // ── Decorative entries ──────────────────────────────────────────────
  router.post(
    '/boats',
    canWrite,
    validate(v.addBoat),
    audit('race.boat.add', (req) => ({ targetType: 'RACE_BOAT', targetId: req.body.name })),
    ctrl.addBoat
  );

  router.put(
    '/boats/:id',
    canWrite,
    validate(v.updateBoat),
    audit('race.boat.update', (req) => ({ targetType: 'RACE_BOAT', targetId: req.params.id, details: req.body })),
    ctrl.updateBoat
  );

  router.delete(
    '/boats/:id',
    noBody(),
    canWrite,
    validate(v.boatParam),
    audit('race.boat.delete', (req) => ({ targetType: 'RACE_BOAT', targetId: req.params.id })),
    ctrl.removeBoat
  );

  return router;
};
