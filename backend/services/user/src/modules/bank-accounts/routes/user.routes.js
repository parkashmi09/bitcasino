'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery } = require('@ibitplay/common');
const { denyAgentPlayer } = require('@ibitplay/auth');

const v = require('../bankAccounts.validators');
const { BankAccountsService } = require('../bankAccounts.service');
const { createControllers } = require('../controllers');

/**
 * Settings → Saved bank accounts, and the account picker on the withdraw form.
 *
 * Every route is the caller's own; none takes a player id. Adding an account
 * is adding a place money can be sent, so — like the crypto whitelist —
 * agent-tree players (no withdrawal rail) may read but not write.
 */
module.exports = function userRoutes(deps) {
  const ctrl = createControllers({ service: new BankAccountsService(deps) });
  const router = Router();
  const noWithdraw = denyAgentPlayer('withdraw');

  router.get('/', noQuery(), ctrl.list);
  router.post('/', noWithdraw, validate(v.create), ctrl.add);
  router.put('/:id/default', noBody(), noWithdraw, validate(v.idParam), ctrl.setDefault);
  router.delete('/:id', noBody(), noWithdraw, validate(v.idParam), ctrl.remove);

  return router;
};
