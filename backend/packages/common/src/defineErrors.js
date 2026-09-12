'use strict';

const { AppError } = require('./errors');

/**
 * Per-module error catalogues.
 *
 * A module declares every failure it can produce in one file, with the status
 * and the client-facing message next to the code:
 *
 *   // settlement.errors.js
 *   module.exports = defineErrors('SETTLEMENT', {
 *     MARKET_ALREADY_SETTLED: { status: 409, message: 'This market has already been settled' },
 *     MARKET_NOT_FOUND:       { status: 404, message: 'Market not found' },
 *   });
 *
 *   // anywhere in the module
 *   throw errors.MARKET_ALREADY_SETTLED({ marketId, settledAt });
 *
 * What this buys over throwing `new ConflictError('...')` inline:
 *
 *   - every code a module can emit is readable in one file, so the API surface
 *     is documentable without grepping for `throw`
 *   - codes are namespaced (`SETTLEMENT_MARKET_ALREADY_SETTLED`) and registered
 *     globally, so two modules cannot ship the same code with different
 *     meanings — the collision throws at BOOT, not in production
 *   - messages live in data, so translating them never touches control flow
 */

/**
 * Global code -> definition registry. Populated at require-time by every
 * `defineErrors` call, which means a duplicate surfaces the moment the module
 * is loaded rather than the first time that specific error is thrown.
 */
const registry = new Map();

/**
 * @param {string} namespace  Module prefix, e.g. 'SETTLEMENT'. UPPER_SNAKE.
 * @param {Record<string, {status: number, message: string, logLevel?: string}>} definitions
 * @returns {Record<string, (details?: object) => AppError>} ready-to-throw factories
 */
function defineErrors(namespace, definitions) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(namespace)) {
    throw new Error(`Error namespace must be UPPER_SNAKE_CASE, got "${namespace}"`);
  }

  const factories = {};

  for (const [key, definition] of Object.entries(definitions)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Error key must be UPPER_SNAKE_CASE, got "${namespace}.${key}"`);
    }

    const { status = 400, message, logLevel = status >= 500 ? 'error' : 'warn' } = definition;
    if (!message) throw new Error(`Error ${namespace}.${key} is missing a message`);

    const code = `${namespace}_${key}`;

    const existing = registry.get(code);
    if (existing && existing.message !== message) {
      throw new Error(
        `Duplicate error code "${code}" — already registered by ${existing.namespace} ` +
          `with a different message. Error codes are a public API contract; two ` +
          `meanings behind one code makes them useless to clients.`
      );
    }
    registry.set(code, { code, namespace, key, status, message, logLevel });

    /**
     * @param {object} [details]  Structured context. Safe to show the client —
     *                            put anything sensitive in `meta` instead.
     * @param {object} [options]
     * @param {string} [options.message]  Override the catalogue message for this
     *                                    one throw. Use sparingly: the code, not
     *                                    the text, is what clients branch on.
     * @param {object} [options.meta]     Logged, never serialised to the client.
     */
    factories[key] = function createError(details, options = {}) {
      const error = new AppError(options.message || message, status, code, details);
      error.namespace = namespace;
      error.logLevel = logLevel;
      if (options.meta) error.meta = options.meta;
      // Drop this factory from the stack so the trace starts at the throw site.
      Error.captureStackTrace(error, createError);
      return error;
    };

    // Expose the definition for docs generation and tests.
    factories[key].code = code;
    factories[key].status = status;
  }

  return Object.freeze(factories);
}

/** Every registered code, for `docs/ERROR-CODES.md` generation and tests. */
function listErrorCodes() {
  return [...registry.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Look up one definition by its wire code. */
function getErrorDefinition(code) {
  return registry.get(code) || null;
}

module.exports = { defineErrors, listErrorCodes, getErrorDefinition };
