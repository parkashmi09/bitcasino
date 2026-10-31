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
          // `res` too: a CREATE learns its target id only in the handler, which
          // runs before this does — it leaves it on `res.locals.activityTargetId`.
          described = describe ? describe(req, res) || {} : {};
          if (described.targetId == null && res.locals?.activityTargetId != null) {
            described.targetId = res.locals.activityTargetId;
          }
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

        /**
         * NEVER THROW FROM HERE. This runs on `res` finish, so the response
         * has already gone out and there is no request left to fail — an
         * exception at this point is an uncaughtException, which takes the
         * whole process down one request after a write that SUCCEEDED.
         *
         * That is not hypothetical: admin-service was built without a client
         * to itself, so `client` was `undefined` for all ten of its audited
         * modules, and creating a staff account answered 201 and then killed
         * the service. Losing an audit row is bad; losing the service after
         * the write it was meant to record is worse, and harder to diagnose
         * because the failing request is never the one that looks wrong.
         */
        if (!client?.post) {
          logger?.error(
            { action, service: serviceName, entry },
            'No audit client injected — staff activity NOT recorded. The action DID happen; this row must be reconstructed by hand'
          );
          return;
        }

        try {
          /**
           * `post(path, body)` — the body is the SECOND POSITIONAL argument.
           *
           * This passed `{ body: entry }`, which `ServiceClient` then sent AS
           * the body, so admin-service received `{"body": {…}}`: no `action`,
           * no `staffId`, a 422 every time. The reply is never awaited and the
           * failure only logs, so the audit trail was empty platform-wide and
           * nothing said so. Every audited write on every service was affected.
           */
          client.post('/internal/admin/audit/activity', entry).catch((error) => {
            logger?.error(
              { err: error, entry },
              'Failed to record staff activity — the action DID happen; this row must be reconstructed by hand'
            );
          });
        } catch (error) {
          logger?.error({ err: error, entry }, 'Audit client threw synchronously — activity NOT recorded');
        }
      });

      next();
    };
  };
}

module.exports = { createActivityRecorder };
