'use strict';

/**
 * Wrap an async route handler so a rejected promise reaches Express's error
 * pipeline instead of hanging the request. Without this, every controller needs
 * its own try/catch and one forgotten `catch` becomes a socket that never closes.
 *
 *   router.get('/me', asyncHandler(async (req, res) => { ... }))
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** Apply asyncHandler to every function on a controller object. */
const wrapController = (controller) =>
  Object.fromEntries(
    Object.entries(controller).map(([key, value]) => [
      key,
      typeof value === 'function' ? asyncHandler(value) : value,
    ])
  );

module.exports = { asyncHandler, wrapController };
