'use strict';

const { z } = require('@ibitplay/common');

const { TRANSFER_DIRECTIONS, TARGET_TYPES, STAFF_STATUS } = require('./staff.constants');

const id = z.coerce.number().int().positive();

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const range = { from: z.coerce.date().optional(), to: z.coerce.date().optional() };

/**
 * Money as a string, always. Legacy compared `amount > bal` with `amount`
 * straight from the body — a float comparison against a NUMERIC column.
 */
const amount = z
  .string({ invalid_type_error: 'send the amount as a string, not a number' })
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a positive decimal with at most 8 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

const name = z.string().trim().min(1).max(120);
const email = z.string().trim().toLowerCase().email().max(255);

/**
 * A staff password.
 *
 * Length is the property that matters and the only one enforced — composition
 * rules push people towards `Password1!` and away from length. Legacy enforced
 * nothing at all, and then stored the result in cleartext beside the hash.
 */
const password = z.string().min(12, 'must be at least 12 characters').max(200);

/** A commission share. Bounded, because it decides what the platform pays out. */
const percentage = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,4})?$/)
  .refine((v) => Number.parseFloat(v) <= 100, 'percentage cannot exceed 100');

// ── Reads ──────────────────────────────────────────────────────────────

const listStaff = {
  query: paging.extend({
    search: z.string().trim().max(120).optional(),
    status: z.enum(STAFF_STATUS).optional(),
  }),
};

const listPlayers = {
  query: paging.extend({ search: z.string().trim().max(120).optional() }),
};

const staffParam = { params: z.object({ staffId: id }) };

const listTransfers = {
  query: paging.extend({
    staffId: id.optional(),
    direction: z.enum(TRANSFER_DIRECTIONS).optional(),
    ...range,
  }),
};

/**
 * `GET /transfers/:staffId` — the same list, scoped by a path segment rather
 * than a query parameter. The param needs its own schema or it reaches the
 * service as an unvalidated raw string, and `listTransfers` validates `query`
 * only.
 */
const listTransfersForStaff = {
  params: z.object({ staffId: id }),
  query: listTransfers.query,
};

const transferSummary = { query: z.object({ staffId: id.optional(), ...range }) };

/**
 * `z.coerce.boolean()` maps EVERY non-empty string to `true`, `"false"`
 * included — so `?includeSubtree=false` asked for the subtree. It decides
 * whether the rollup sums one balance or the whole branch's, which is the
 * difference between an account's own money and everything beneath it.
 */
const flag = (fallback) =>
  z
    .enum(['true', 'false'])
    .default(String(fallback))
    .transform((v) => v === 'true');

const rollup = {
  params: z.object({ staffId: id }),
  query: z.object({ includeSubtree: flag(false) }),
};

const analytics = {
  params: z.object({ staffId: id }),
  query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }),
};

// ── Writes ─────────────────────────────────────────────────────────────

const createStaff = {
  body: z
    .object({
      name, email, password,
      phone: z.string().trim().max(30).optional(),
      country: z.string().trim().max(60).optional(),
      roleId: id,
      percentage: percentage.optional(),
    })
    .strict(),
};

const updateStaff = {
  params: z.object({ staffId: id }),
  body: z
    .object({
      name: name.optional(),
      phone: z.string().trim().max(30).optional(),
      country: z.string().trim().max(60).optional(),
      status: z.enum(STAFF_STATUS).optional(),
      percentage: percentage.optional(),
    })
    .strict()
    // Legacy built its SET clause from whichever fields were present; given
    // none it produced an UPDATE with an empty SET.
    .refine((v) => Object.keys(v).length > 0, { message: 'give at least one field to change' }),
};

/**
 * A transfer.
 *
 * There is no `fromId`. The payer is the authenticated actor on a deposit and
 * the named target on a withdrawal — derived from `direction`, never supplied.
 */
const transfer = {
  body: z
    .object({
      toType: z.enum(TARGET_TYPES),
      toId: id,
      amount,
      direction: z.enum(TRANSFER_DIRECTIONS).default('deposit'),
    })
    .strict(),
};

const changePassword = {
  body: z
    .object({
      // Absent means "my own". Present means a reset, which needs the
      // permission the route checks.
      targetId: id.optional(),
      oldPassword: z.string().min(1).max(200).optional(),
      newPassword: password,
    })
    .strict()
    .refine((v) => v.targetId !== undefined || v.oldPassword !== undefined, {
      message: 'changing your own password requires the current one',
      path: ['oldPassword'],
    }),
};

const bulkStatus = {
  body: z
    .object({
      // Bounded: this becomes one UPDATE ... WHERE id IN (...).
      ids: z.array(id).min(1).max(500),
      status: z.enum(STAFF_STATUS),
    })
    .strict(),
};

module.exports = {
  listStaff, listPlayers, staffParam, listTransfers, listTransfersForStaff, transferSummary, rollup, analytics,
  createStaff, updateStaff, transfer, changePassword, bulkStatus,
};
