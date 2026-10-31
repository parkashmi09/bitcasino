'use strict';

/**
 * Staff activity audit.
 *
 * Replaces `legacy/system/utils/recordActivity`, which wrote directly into
 * `admin_activity_logs` from whichever service happened to be handling the
 * request. Only admin-service owns that table now, so the record goes over the
 * internal API.
 *
 *   router.post('/declare-result',
 *     validate(v.declareResult),
 *     withActivity({
 *       action: 'settle.declare-result',
 *       describe: (req) => ({ targetType: 'MARKET', targetId: req.body.match_id }),
 *     }),
 *     ctrl.declareResult);
 *
 * Two properties matter:
 *
 *   1. It records the OUTCOME, not the attempt. The audit row is written after
 *      the response, carrying the status code, so a rejected settlement is
 *      distinguishable from one that went through. Legacy recorded before the
 *      handler ran, so a 500 left an audit trail claiming the market had been
 *      settled.
 *
 *   2. Audit failure never fails the request. The money movement already
 *      committed; refusing the response because the log write failed would be
 *      strictly worse. It logs at `error` with everything needed to reconstruct
 *      the row by hand.
 */

/**
 * @param {object} opts
 * @param {object} opts.client  ServiceClient pointed at admin-service.
 * @param {object} opts.logger
 * @param {string} opts.serviceName
 */
function createActivityRecorder({ client, logger, serviceName }) {
  /**
   * @param {object} options
   * @param {string} options.action    Stable action id, e.g. 'settle.void-market'.
   * @param {(req) => object} [options.describe]  Extra context: targetType, targetId, details.
   * @param {boolean} [options.onFailureToo=true] Also record rejected attempts.
   */
  return function withActivity({ action, describe, onFailureToo = true }) {
    return function withActivityMiddleware(req, res, next) {
      res.on('finish', () => {
        const succeeded = res.statusCode < 400;
        if (!succeeded && !onFailureToo) return;

        // An unauthenticated request never reached the handler; there is no
        // actor to attribute and nothing worth recording.
        const actor = req.staff;
        if (!actor) return;

        let described = {};
        try {
          described = describe ? describe(req) || {} : {};
        } catch (error) {
          logger?.warn({ err: error, action }, 'Activity describe() threw — recording without details');
        }

        const entry = {
          action,
          service: serviceName,
          staffId: actor.id,
          executiveId: actor.executiveId || null,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          outcome: succeeded ? 'success' : 'rejected',
          ip: req.ip,
          userAgent: req.headers['user-agent'] || null,
          requestId: req.id || null,
          ...described,
        };

        client.post('/internal/admin/audit/activity', { body: entry }).catch((error) => {
          logger?.error(
            { err: error, entry },
            'Failed to record staff activity — the action DID happen; this row must be reconstructed by hand'
          );
        });
      });

      next();
    };
  };
}

module.exports = { createActivityRecorder };
