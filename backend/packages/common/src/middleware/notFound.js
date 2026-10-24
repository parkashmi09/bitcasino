'use strict';

const { NotFoundError } = require('../errors');

/**
 * Terminal 404 handler. Mounted after every route so an unmatched path becomes
 * a normal AppError and flows through the same envelope as everything else,
 * rather than Express's default HTML error page.
 */
function notFound() {
  return function notFoundMiddleware(req, _res, next) {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} does not exist`));
  };
}

module.exports = { notFound };
