'use strict';

const { Router } = require('express');
const multer = require('multer');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../bankDetails.validators');
const { BankDetailsService } = require('../bankDetails.service');
const { createControllers } = require('../controllers');

/**
 * Managing the house's deposit destinations.
 *
 * These three were unauthenticated in legacy. Adding a bank account here
 * changes where players are told to send money, so each one is permissioned
 * and audited with the account details recorded.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new BankDetailsService(deps);
  const ctrl = createControllers({ service });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype)),
  });

  const audit = (action) =>
    withActivity({
      action,
      describe: (req) => ({
        targetType: 'PAYMENT_DESTINATION',
        targetId: req.params.id || req.params.coin_type,
        details: {
          coinType: req.params.coin_type,
          bankName: req.body?.bankName,
          // The last four digits are enough to identify the row in an audit
          // trail without copying a full account number into the log.
          accountNumberLast4: req.body?.accountNumber?.slice(-4),
          upiId: req.body?.upiId,
        },
      }),
    });

  const router = Router();

  router.get('/:coin_type', auth.requirePermission(PERMISSIONS.CONFIG_READ), validate(v.coinParam), ctrl.listAll);

  router.post('/:coin_type', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), upload.single('qr_image'), validate(v.create), audit('bank-details.create'), ctrl.create);

  router.put('/:coin_type/:id', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), upload.single('qr_image'), validate(v.update), audit('bank-details.update'), ctrl.update);

  router.delete('/:coin_type/:id', auth.requirePermission(PERMISSIONS.CONFIG_WRITE), validate(v.remove), audit('bank-details.deactivate'), ctrl.remove);

  return router;
};
