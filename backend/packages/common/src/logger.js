'use strict';

const pino = require('pino');

/**
 * Structured logging. Every service creates one root logger tagged with its
 * name; request-scoped children carry the request id so a single call can be
 * traced across the gateway and every service it fans out to.
 */

// Anything matching these paths is replaced with [Redacted] before it is written.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-key"]',
  'password',
  'passwordConfirm',
  'currentPassword',
  'newPassword',
  '*.password',
  'token',
  'accessToken',
  'refreshToken',
  'totpSecret',
  'twoFactorSecret',
  'serverSeed',
];

function createLogger({ service, level = 'info', pretty = false } = {}) {
  const options = {
    name: service,
    level,
    base: { service, pid: process.pid },
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    try {
      // pino-pretty is a dev-only convenience; fall back to JSON if absent.
      return pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service', messageFormat: `[${service}] {msg}` },
        },
      });
    } catch {
      /* pino-pretty not installed — use JSON */
    }
  }

  return pino(options);
}

module.exports = { createLogger, REDACT_PATHS };
