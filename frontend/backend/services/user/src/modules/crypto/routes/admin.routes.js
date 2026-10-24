'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../crypto.validators');
const { CryptoService } = require('../crypto.service');

/**
 * Staff entry of an out-of-band INR deposit.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `POST /hr` LET ANYONE FABRICATE A DEPOSIT RECORD FOR ANY ACCOUNT
 *
 *     server.post("/hr", function (req, res) {
 *       res.setHeader("Access-Control-Allow-Origin", "*");
 *       const { uid, date, amount_deposit, txid_in, status, name } = req.body;
 *       inr_deposit.inrapi({ uid, date, amount_deposit, txid_in, status, name });
 *       res.send(req.body);
 *     });
 *
 * No middleware. `inr_deposit` is the list an operator works from when
 * approving manual deposits, so a fabricated row saying `status: 'success'` is
 * a request for real money that looks like it already arrived.
 *
 * Behind `deposits:approve` here, and audited — entering a deposit on
 * somebody's word is a decision with a name attached.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const service = new CryptoService(deps);

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  /** @legacy POST /hr */
  router.post(
    '/inr-deposits',
    auth.requirePermission(PERMISSIONS.DEPOSITS_APPROVE),
    validate(v.recordInrDeposit),
    withActivity({
      action: 'deposit.inr.record',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.body.userId,
        details: {
          amount: req.body.amount,
          transactionId: req.body.transactionId,
          status: req.body.status,
        },
      }),
    }),
    asyncHandler(async (req, res) =>
      response.created(res, await service.recordInrDeposit({ actor: req.staff, ...req.body }))
    )
  );

  return router;
};
