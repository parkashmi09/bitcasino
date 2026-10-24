'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

const errors = require('../xCasino.errors');
const envelope = require('../envelope');
const { verify } = require('../signature');

/**
 * The provider callbacks.
 *
 * Every one of them: verify the signature over the WHOLE request, do the work,
 * answer 200 in the provider's envelope whatever happened.
 */
function createControllers({ service, config, logger }) {
  const secret = config?.XCASINO_SECRET;
  const allowLegacy = config?.XCASINO_ALLOW_LEGACY_HASH === true || config?.XCASINO_ALLOW_LEGACY_HASH === 'true';

  /**
   * Wrap a callback handler.
   *
   * The signature check happens here rather than in each handler, so a route
   * added later cannot skip it — the same reason the module loader attaches
   * auth guards rather than trusting each module to remember.
   */
  const callback = (handle) =>
    asyncHandler(async (req, res) => {
      const { command, request_timestamp: requestTimestamp, hash, data } = req.body;
      const context = { command, requestTimestamp, hash, data };

      /**
       * `req.rawBody` is captured by the shared app for exactly this. A check
       * against `JSON.stringify(req.body)` would compare against a
       * re-serialisation, which can differ from what was sent.
       */
      const verdict = verify({
        command,
        requestTimestamp,
        rawBody: req.rawBody ? req.rawBody.toString('utf8') : '',
        hash,
        secret,
        allowLegacy,
      });

      if (!verdict.ok) {
        logger?.warn(
          { command, reason: verdict.reason, requestTimestamp },
          'Casino callback REJECTED — signature did not verify'
        );
        const error = verdict.reason === 'stale or unparseable timestamp'
          ? errors.STALE_REQUEST({ requestTimestamp })
          : errors.BAD_SIGNATURE({ reason: verdict.reason });
        return envelope.fail(res, context, error, { secret });
      }

      if (verdict.mode === 'legacy') {
        /**
         * Loud, every single time.
         *
         * The legacy signature covers only `command` and `request_timestamp` —
         * not `data`, where `user_id` and `amount` live. Accepting it means one
         * captured request authenticates any body. It exists as a migration
         * path and the log line says what it costs.
         */
        logger?.warn(
          { command, requestTimestamp },
          'Casino callback accepted on the LEGACY signature — the payload was NOT authenticated. ' +
            'Set XCASINO_ALLOW_LEGACY_HASH=false once the provider signs the body.'
        );
      }

      try {
        const payload = await handle(data, req);
        return envelope.ok(res, context, payload, { secret });
      } catch (error) {
        if (error?.code?.startsWith('XCASINO_')) {
          logger?.warn({ command, code: error.code, details: error.details }, 'Casino callback refused');
          return envelope.fail(res, context, error, { secret });
        }
        // Something unexpected. The provider gets its internal-error code; the
        // stack goes to our logs, not to them.
        logger?.error({ err: error, command }, 'Casino callback failed unexpectedly');
        return envelope.fail(res, context, null, { secret });
      }
    });

  return {
    /** @legacy POST /api/casino/authenticate */
    authenticate: callback((data) => service.authenticate({ session: data.session })),

    /** @legacy POST /api/casino/balance */
    balance: callback((data) =>
      service.balance({ session: data.session, userId: data.user_id, currencyCode: data.currency_code })
    ),

    /** @legacy POST /api/casino/changebalance */
    changeBalance: callback((data) =>
      service.changeBalance({
        session: data.session,
        userId: data.user_id,
        transactionId: data.transaction_id,
        roundId: data.round_id,
        transactionType: data.transaction_type,
        amount: data.amount,
        currencyCode: data.currency_code,
        roundFinished: data.round_finished,
        gameId: data.game_id,
        reason: data.reason,
        transactionTimestamp: data.transaction_timestamp,
      })
    ),

    /** @legacy POST /api/casino/status */
    status: callback((data) => service.status({ transactionId: data.transaction_id, userId: data.user_id })),

    /** @legacy POST /api/casino/cancel */
    cancel: callback((data) =>
      service.cancel({
        transactionId: data.transaction_id,
        userId: data.user_id,
        cancelTransactionId: data.cancel_transaction_id,
      })
    ),

    // ── the player's own routes, in the platform envelope ──────────────

    /** @legacy POST /api/casino/gamerun */
    openGame: asyncHandler(async (req, res) =>
      response.created(res, await service.openGame({ ...req.body, userId: req.user.id }))
    ),

    /** @legacy GET /api/casino/casino-balance */
    myBalance: asyncHandler(async (req, res) => {
      const balance = await service.balanceForPlayer({ userId: req.user.id, currency: req.query.currency });
      return response.ok(res, balance);
    }),
  };
}

module.exports = { createControllers };
