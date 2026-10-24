'use strict';

const { signResponse } = require('./signature');
const { providerCodeFor } = require('./providerCodes');
const { PROVIDER_ERROR } = require('./xCasino.constants');

/**
 * The provider's response envelope.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A CALLBACK ALWAYS ANSWERS 200
 *
 * The provider reads `response.status` and `response.data.error_code`. Legacy
 * answered 403, 400, 404 and 500 for the various failures — which most
 * aggregator clients treat as "the operator is down, retry", turning a clean
 * rejection into a retry storm against an endpoint that moves money.
 *
 * Everything here is a 200 carrying the provider's own error code, which is
 * the shape the integration document specifies and the shape the other
 * provider callbacks in this port already use.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ── ONE TIMESTAMP ────────────────────────────────────────────────────────
 *
 * Legacy called `getCurrentTimestamp()` twice per response — once for the
 * `response_timestamp` field and once inside `generateResponseHash(...)`:
 *
 *     response_timestamp: getCurrentTimestamp(),
 *     hash: generateResponseHash('ERROR', getCurrentTimestamp()),
 *
 * Those two calls land on different seconds whenever the response is built
 * across a second boundary. When that happens the provider's verification of
 * our response fails — intermittently, rarely, with nothing in the logs to
 * explain it. Computed once here and used for both.
 */

/** The provider's timestamp format: `YYYY-MM-DD HH:MM:SS`, UTC. */
const providerTimestamp = (now = new Date()) => now.toISOString().replace('T', ' ').slice(0, 19);

function ok(res, { command, requestTimestamp, hash, data }, payload, { secret }) {
  const responseTimestamp = providerTimestamp();

  return res.status(200).json({
    request: { command, request_timestamp: requestTimestamp, hash, data },
    response: {
      status: 'OK',
      response_timestamp: responseTimestamp,
      hash: signResponse({ status: 'OK', responseTimestamp, secret }),
      data: payload,
    },
  });
}

/**
 * A refusal, in the provider's envelope.
 *
 * `error_message` is OUR message, which is safe to show: the error catalogue's
 * messages are written for a client. Anything sensitive goes in `details`,
 * which is not serialised here.
 */
function fail(res, { command, requestTimestamp, hash, data }, error, { secret }) {
  const responseTimestamp = providerTimestamp();

  const errorCode = error?.code ? providerCodeFor(error.code) : PROVIDER_ERROR.INTERNAL.code;
  const errorMessage = error?.code ? error.message : PROVIDER_ERROR.INTERNAL.message;

  return res.status(200).json({
    request: { command, request_timestamp: requestTimestamp, hash, data },
    response: {
      status: 'ERROR',
      response_timestamp: responseTimestamp,
      hash: signResponse({ status: 'ERROR', responseTimestamp, secret }),
      data: { error_code: errorCode, error_message: errorMessage },
    },
  });
}

module.exports = { ok, fail, providerTimestamp };
