'use strict';

/**
 * One error taxonomy for every service.
 *
 * Controllers throw these; the shared error handler is the only place that
 * decides what the client sees. Anything that is NOT an AppError is treated as
 * an unexpected bug: it is logged with a stack and reported as a generic 500,
 * so an internal message never leaks through a response body.
 */

class AppError extends Error {
  /**
   * @param {string} message  Safe to show the client.
   * @param {number} status   HTTP status.
   * @param {string} code     Stable machine-readable code, e.g. INSUFFICIENT_FUNDS.
   * @param {object} [details] Extra structured context (field errors, balances…).
   */
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    // Expected errors are safe to show verbatim; unexpected ones are not.
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request', details) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', details) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details) {
    super(message, 409, 'CONFLICT', details);
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', details) {
    super(message, 429, 'TOO_MANY_REQUESTS', details);
  }
}

/** Business rules that are not simple input errors — insufficient funds, market closed, etc. */
class BusinessRuleError extends AppError {
  constructor(message, code = 'BUSINESS_RULE_VIOLATION', details) {
    super(message, 422, code, details);
  }
}

class InsufficientFundsError extends AppError {
  constructor(message = 'Insufficient balance', details) {
    super(message, 422, 'INSUFFICIENT_FUNDS', details);
  }
}

/** A downstream service failed or timed out. */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Upstream service unavailable', details) {
    super(message, 503, 'SERVICE_UNAVAILABLE', details);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
  BusinessRuleError,
  InsufficientFundsError,
  ServiceUnavailableError,
};
