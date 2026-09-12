'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../club.validators');
const { ClubService } = require('../club.service');
const { createControllers } = require('../controllers');

/**
 * Clubs, from a player's side.
 *
 * Every legacy route here was unauthenticated and named the player in the body
 * or the URL. Two consequences worth stating: anyone could put anyone into any
 * club, and anyone could promote themselves to `agent` — which mints a
 * recruitment code and a share of the earnings split.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new ClubService(deps) });
  const router = Router();

  router.get('/me', ctrl.myMembership);
  // Before `/:clubId` in the file for readability only — the two cannot collide,
  // one has an extra segment.
  router.get('/owner/:ownerId', validate(v.ownerParam), ctrl.ownerProfile);
  router.get('/:clubId', validate(v.clubParam), ctrl.getClub);
  router.get('/:clubId/hierarchy', validate(v.clubParam), ctrl.hierarchy);
  router.get('/:clubId/members', validate(v.listMembers), ctrl.members);
  router.get('/:clubId/earnings-config', validate(v.clubParam), ctrl.earningsConfig);
  router.get('/:clubId/earnings', validate(v.earningsLog), ctrl.earningsLog);

  router.post('/', validate(v.createClub), ctrl.create);
  router.put('/:clubId', validate(v.updateClub), ctrl.update);
  router.delete('/:clubId', validate(v.clubParam), ctrl.remove);

  router.post('/join', validate(v.join), ctrl.join);
  router.post('/leave', ctrl.leave);
  router.post('/members/role', validate(v.changeRole), ctrl.changeRole);

  router.put('/:clubId/earnings-config', validate(v.earningsConfig), ctrl.setEarningsConfig);

  return router;
};
