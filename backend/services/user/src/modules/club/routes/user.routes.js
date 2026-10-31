'use strict';

const { Router } = require('express');
const { validate, entitlements, noBody, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

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

  // Not in the owner's plan: every route here answers 403 NOT_ENTITLED (docs/OWNER-PANEL.md §4).
  router.use(entitlements.requireFeature('club_membership'));
  // After the plan check: agent-tree players (owner at staff level 4–6) have no promotions.
  router.use(denyAgentPlayer('promotions'));

  router.get('/me', noQuery(), ctrl.myMembership);
  // Before `/:clubId` in the file for readability only — the two cannot collide,
  // one has an extra segment.
  router.get('/owner/:ownerId', noQuery(), validate(v.ownerParam), ctrl.ownerProfile);
  router.get('/:clubId', noQuery(), validate(v.clubParam), ctrl.getClub);
  router.get('/:clubId/hierarchy', noQuery(), validate(v.clubParam), ctrl.hierarchy);
  router.get('/:clubId/members', validate(v.listMembers), ctrl.members);
  router.get('/:clubId/earnings-config', noQuery(), validate(v.clubParam), ctrl.earningsConfig);
  router.get('/:clubId/earnings', validate(v.earningsLog), ctrl.earningsLog);

  router.post('/', validate(v.createClub), ctrl.create);
  router.put('/:clubId', validate(v.updateClub), ctrl.update);
  router.delete('/:clubId', noBody(), validate(v.clubParam), ctrl.remove);

  router.post('/join', validate(v.join), ctrl.join);
  router.post('/leave', noBody(), ctrl.leave);
  router.post('/members/role', validate(v.changeRole), ctrl.changeRole);

  router.put('/:clubId/earnings-config', validate(v.earningsConfig), ctrl.setEarningsConfig);

  return router;
};
