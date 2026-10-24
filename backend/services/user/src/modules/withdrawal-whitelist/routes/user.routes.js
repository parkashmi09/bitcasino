'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../whitelist.validators');
const { WhitelistService } = require('../whitelist.service');
const { createControllers } = require('../controllers');

/**
 * Settings → Whitelist Management, and the address picker on the withdraw form.
 *
 * Every route is the caller's own; none takes a player id. This is the
 * resource an attacker holding a session would most want to write, because
 * adding an address is how stolen funds leave.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new WhitelistService(deps) });
  const router = Router();

  // Payout destinations: agent-tree players have no withdrawal rail, so every
  // write is refused. The list stays readable.
  const noWithdraw = denyAgentPlayer('withdraw');

  router.get('/', noQuery(), ctrl.list);
  router.post('/', noWithdraw, validate(v.create), ctrl.add);

  /* BEFORE `/:id`, or Express matches the literal against the parameter and a
     switch toggle arrives as a request to rename an address called
     "enforcement". The same ordering the notifications module needed. */
  router.put('/enforcement', noWithdraw, validate(v.enforcement), ctrl.setEnforcement);

  router.patch('/:id', noWithdraw, validate(v.rename), ctrl.rename);
  router.delete('/:id', noBody(), noWithdraw, validate(v.idParam), ctrl.remove);

  return router;
};
