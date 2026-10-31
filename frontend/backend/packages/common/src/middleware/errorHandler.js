'use strict';

const { AppError } = require('../errors');
const { fail } = require('../response');

/**
 * The single place that converts a thrown error into an HTTP response.
 *
 * Rules:
 *   - AppError            -> its own status/code/message (safe to show).
 *   - Sequelize errors    -> translated to the right 4xx with field details.
 *   - anything else       -> 500 with a generic message; the real error is
 *                            logged with its stack and never sent to the client.
 */

/** Turn Sequelize validation/constraint errors into structured field errors. */
function fromSequelize(err) {
  switch (err.name) {
    case 'SequelizeUniqueConstraintError': {
      const details = (err.errors || []).map((e) => ({
        field: e.path,
        message: `${e.path} is already taken`,
      }));
      return { status: 409, code: 'CONFLICT', message: 'Resource already exists', details: details.length ? details : undefined };
    }
    case 'SequelizeValidationError': {
      const details = (err.errors || []).map((e) => ({ field: e.path, message: e.message }));
      return { status: 422, code: 'VALIDATION_ERROR', message: 'Validation failed', details };
    }
    case 'SequelizeForeignKeyConstraintError':
      return { status: 409, code: 'FOREIGN_KEY_VIOLATION', message: 'Referenced record does not exist' };
    case 'SequelizeDatabaseError':
      // Never surface raw SQL — it can disclose schema details.
      return { status: 500, code: 'DATABASE_ERROR', message: 'Database error' };
    case 'SequelizeConnectionError':
    case 'SequelizeConnectionRefusedError':
    case 'SequelizeHostNotFoundError':
    case 'SequelizeConnectionTimedOutError':
      return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'Database temporarily unavailable' };
    case 'SequelizeTimeoutError':
      return { status: 504, code: 'DATABASE_TIMEOUT', message: 'Database query timed out' };
    default:
      return null;
  }
}

function errorHandler({ logger, exposeStack = false } = {}) {
  // Express identifies error middleware by arity — all four params are required.
  return function errorHandlerMiddleware(err, req, res, _next) {
    // The response already started streaming; the only safe move is to destroy it.
    if (res.headersSent) {
      req.log?.error({ err }, 'Error after headers were sent');
      return res.destroy();
    }

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong';
    let details;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err?.name?.startsWith('Sequelize')) {
      const mapped = fromSequelize(err);
      if (mapped) ({ status, code, message, details } = mapped);
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      code = 'MALFORMED_JSON';
      message = 'Request body is not valid JSON';
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request body is too large';
    } else if (err?.code === 'EBADCSRFTOKEN') {
      status = 403;
      code = 'INVALID_CSRF_TOKEN';
      message = 'Invalid CSRF token';
    }

    const log = req.log || logger;
    const payload = {
      err,
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status,
      code,
      userId: req.user?.id ?? null,
      staffId: req.staff?.id ?? null,
    };

    // 5xx means we broke something — log loudly with the stack. 4xx is the
    // client's problem and would otherwise drown the logs, so keep it at warn.
    if (status >= 500) log?.error(payload, message);
    else log?.warn(payload, message);

    const responseDetails = { requestId: req.id };
    if (Array.isArray(details)) responseDetails.fields = details;
    else if (details && typeof details === 'object') Object.assign(responseDetails, details);
    if (exposeStack && status >= 500) {
      responseDetails.stack = String(err.stack || '').split('\n').slice(0, 8);
    }

    return fail(res, status, code, message, responseDetails);
  };
}

module.exports = { errorHandler };
