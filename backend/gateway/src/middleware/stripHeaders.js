'use strict';

const { INTERNAL_KEY_HEADER, INTERNAL_SERVICE_HEADER } = require('@ibitplay/common');

/**
 * Delete every header a client could use to impersonate something.
 *
 * This runs BEFORE authentication, and it is the single most important
 * middleware in the gateway. Downstream services trust `x-user-id` and
 * `x-staff-id` because the gateway sets them from a verified token — so if a
 * client could send those headers itself, the entire auth model would be one
 * curl away from bypassed:
 *
 *   curl -H 'x-user-id: 1' https://api.example.com/api/v1/user/wallet
 *
 * `x-internal-key` is stripped for the same reason: an internal route is
 * supposed to be unreachable from the edge, and a forwarded key would make it
 * reachable.
 *
 * Deleted, never rejected. A rejection tells an attacker the header is
 * meaningful; silently dropping it is indistinguishable from it never having
 * mattered.
 */
const SPOOFABLE_HEADERS = [
  'x-user-id',
  'x-staff-id',
  'x_staff_id',
  'x-executive-id',
  'x-roles',
  'x-permissions',
  'x-staff-level',
  'x-internal-caller',
  INTERNAL_KEY_HEADER,
  INTERNAL_SERVICE_HEADER,
];

function stripHeaders() {
  return function stripHeadersMiddleware(req, _res, next) {
    for (const header of SPOOFABLE_HEADERS) {
      if (req.headers[header] !== undefined) {
        req.log?.warn(
          { header, ip: req.ip, path: req.originalUrl },
          'Client sent a reserved header — stripped'
        );
        delete req.headers[header];
      }
    }
    next();
  };
}

module.exports = { stripHeaders, SPOOFABLE_HEADERS };
