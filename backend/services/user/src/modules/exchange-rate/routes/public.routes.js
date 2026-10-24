'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../exchangeRate.validators');
const { ExchangeRateService } = require('../exchangeRate.service');
const { createControllers } = require('../controllers');

/**
 * Reading rates is public.
 *
 * The deposit and swap screens need them before a player signs in, and a rate
 * is not a secret — it is printed on the page. Only WRITING is restricted.
 */
module.exports = function publicRoutes(deps) {
  const service = new ExchangeRateService(deps);
  const ctrl = createControllers({ service });

  const router = Router();

  router.get('/rates', ctrl.list);
  router.get('/convert', validate(v.convert), ctrl.convert);
  // Legacy path shape, kept so the old URL maps one-to-one.
  router.get('/convert/:from/:to/:amount', validate(v.convertParams), ctrl.convertByPath);
  router.get('/rates/:currency', validate(v.currencyParam), ctrl.get);

  return router;
};
