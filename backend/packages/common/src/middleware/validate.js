'use strict';

const { z } = require('zod');
const { ValidationError } = require('../errors');

/**
 * Request validation.
 *
 * A route declares zod schemas per request part; the parsed (and coerced)
 * result REPLACES req.body / req.query / req.params. That matters: downstream
 * code then works with typed, stripped values — an attacker cannot smuggle an
 * extra `role: "admin"` field through, because zod objects drop unknown keys.
 *
 *   router.post('/login', validate({ body: loginSchema }), controller.login)
 */
function validate(schemas = {}) {
  return function validateMiddleware(req, _res, next) {
    const issues = [];

    for (const part of ['params', 'query', 'body', 'headers']) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            field: [part, ...issue.path].join('.').replace(/^body\./, ''),
            message: issue.message,
            code: issue.code,
          });
        }
        continue;
      }

      // req.query and req.params are getter-only on Express 5 / some setups —
      // defineProperty keeps this working in both.
      try {
        req[part] = result.data;
      } catch {
        Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true });
      }
    }

    if (issues.length) return next(new ValidationError('Validation failed', issues));
    return next();
  };
}

// ── Reusable primitives ────────────────────────────────────────────────

/** Positive integer id from a URL segment (arrives as a string). */
const idParam = z.coerce.number().int().positive();

/** Standard list query: ?page=1&limit=20&sort=createdAt:desc&search=foo */
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*:(asc|desc)$/i, 'sort must look like "field:asc"').optional(),
  search: z.string().trim().max(120).optional(),
});

/** A monetary amount: accepts number or numeric string, rejects NaN/negatives. */
const amount = z.coerce
  .number()
  .finite('amount must be a finite number')
  .positive('amount must be greater than zero');

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'invalid currency code');

const email = z.string().trim().toLowerCase().email('invalid email address').max(190);

const username = z
  .string()
  .trim()
  .min(3, 'username must be at least 3 characters')
  .max(32, 'username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'username may only contain letters, numbers, dot, dash and underscore');

/**
 * Password policy. Length comes from env so ops can tighten it without a deploy.
 * We require mixed character classes rather than an arbitrary regex soup.
 */
const password = (minLength = 8) =>
  z
    .string()
    .min(minLength, `password must be at least ${minLength} characters`)
    .max(128, 'password must be at most 128 characters')
    .refine((v) => /[a-z]/.test(v), 'password must contain a lowercase letter')
    .refine((v) => /[A-Z]/.test(v), 'password must contain an uppercase letter')
    .refine((v) => /[0-9]/.test(v), 'password must contain a number');

const totpCode = z.string().trim().regex(/^\d{6}$/, 'code must be 6 digits');

module.exports = {
  validate,
  schemas: { idParam, paginationQuery, amount, currencyCode, email, username, password, totpCode },
  z,
};
