'use strict';

/**
 * mssports handlers answer a failure as `{ success: false, error: "text" }` or `{ success: false,
 * message }`. Routes behind this middleware answer in the platform's standard envelope instead:
 * `{ success: false, error: { code, message } }` (common/response.js). The text is kept, 5xx too:
 * these routes are the Super Admin's own, and the settle screens show why a settlement failed.
 */
const CODES = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'VALIDATION_ERROR', 429: 'TOO_MANY_REQUESTS' };

function toStandard(status, body) {
  if (!body || typeof body !== 'object' || body.success !== false) return body;
  if (body.error && typeof body.error === 'object') return body; // already standard
  const text = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : null;
  return {
    success: false,
    error: {
      code: typeof body.code === 'string' ? body.code : status >= 500 ? 'INTERNAL_ERROR' : CODES[status] ?? 'BAD_REQUEST',
      message: text ?? 'Request failed',
    },
  };
}

function standardEnvelope({ logger } = {}) {
  return function standardEnvelopeMiddleware(req, res, next) {
    const json = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode || 200;
      if (status >= 500 && body?.success === false) logger?.error?.({ path: req.originalUrl, body }, 'Sports handler failed');
      return json(status >= 400 ? toStandard(status, body) : body);
    };
    next();
  };
}

module.exports = { standardEnvelope, toStandard };
