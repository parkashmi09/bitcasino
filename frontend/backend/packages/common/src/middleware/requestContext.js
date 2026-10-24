'use strict';

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Request-scoped context.
 *
 * The gateway stamps `x-request-id` on every inbound call and forwards it to
 * each service; services reuse it rather than minting a new one, so one player
 * action produces one traceable id across the whole platform.
 *
 * The AsyncLocalStorage store lets deep code (repositories, service clients)
 * read the request id without threading it through every signature.
 */

const storage = new AsyncLocalStorage();

const REQUEST_ID_HEADER = 'x-request-id';

function requestContext() {
  return function requestContextMiddleware(req, res, next) {
    const requestId = req.headers[REQUEST_ID_HEADER] || crypto.randomUUID();

    req.id = requestId;
    req.startedAt = process.hrtime.bigint();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const context = {
      requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      // Populated later by the authenticate middleware.
      userId: null,
      staffId: null,
    };
    req.context = context;

    storage.run(context, () => next());
  };
}

/** Read the ambient request context from anywhere inside the request lifecycle. */
const getContext = () => storage.getStore() || null;
const getRequestId = () => getContext()?.requestId || null;

module.exports = { requestContext, getContext, getRequestId, REQUEST_ID_HEADER, storage };
