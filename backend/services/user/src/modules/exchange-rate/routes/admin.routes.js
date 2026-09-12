'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../exchangeRate.validators');
const { ExchangeRateService } = require('../exchangeRate.service');
const { createControllers } = require('../controllers');

/**
 * Changing a rate is a staff action.
 *
 * In legacy these three were unauthenticated. A rate decides what every
 * subsequent swap pays out, so `PUT /rates/USDT` with a rate of 0.0001 was a
 * one-request way to drain balances through the swap endpoint. Every change is
 * now permissioned and audited.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new ExchangeRateService(deps);
  const ctrl = createControllers({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  const audit = (action) =>
    withActivity({
      action,
      describe: (req) => ({
        targetType: 'EXCHANGE_RATE',
        targetId: req.params.currency || req.body.currency,
        details: { usdRate: req.body?.usdRate },
      }),
    });

  router.post('/rates', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.addRate), audit('rate.add'), ctrl.add);

  router.put('/rates/:currency', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.updateRate), audit('rate.update'), ctrl.update);

  router.delete('/rates/:currency', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.currencyParam), audit('rate.delete'), ctrl.remove);

  return router;
};
