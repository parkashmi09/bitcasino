'use strict';

const { z } = require('@ibitplay/common');
const { ALL_PERMISSIONS } = require('@ibitplay/auth');

const { EXECUTIVE_KINDS, EXECUTIVE_STATUSES } = require('./access.constants');

const id = z.coerce.number().int().positive();

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9._-]+$/, 'may contain letters, digits and . _ - only');

/**
 * A sub-login password.
 *
 * Legacy required SIX characters for an account that carries staff authority.
 * Length is the property that matters and the only one enforced — composition
 * rules push people towards `Passw0rd!`.
 */
const password = z.string().min(12, 'must be at least 12 characters').max(200);

/**
 * The permission grant.
 *
 * A flat list of known permission strings — not legacy's `{groups, pages,
 * authority}` blob, which was validated by checking that those three keys were
 * objects and never by looking inside them.
 *
 * Membership of `ALL_PERMISSIONS` is checked here and the grant is intersected
 * with the CREATOR's own authority in the service. Two gates: this one catches
 * a typo, that one catches an escalation.
 */
const permissions = z
  .array(z.enum([...ALL_PERMISSIONS, '*']))
  .min(1, 'give at least one permission')
  .max(ALL_PERMISSIONS.length + 1);

const listExecutives = {
  query: paging.extend({
    status: z.enum(EXECUTIVE_STATUSES).optional(),
    search: z.string().trim().max(100).optional(),
  }),
};

const executiveParam = { params: z.object({ executiveId: id }) };

const createExecutive = {
  body: z.object({ username, password, permissions }).strict(),
};

const updateExecutive = {
  params: z.object({ executiveId: id }),
  body: z.object({ permissions }).strict(),
};

const resetPassword = {
  params: z.object({ executiveId: id }),
  body: z.object({ password }).strict(),
};

/**
 * Suspend or restore.
 *
 * An enum, not legacy's `{ status }` for executives and `{ lock }` for
 * marketing users — the same operation with two different body shapes, which is
 * why the two handlers had drifted.
 */
const setStatus = {
  params: z.object({ executiveId: id }),
  body: z.object({ status: z.enum(EXECUTIVE_STATUSES) }).strict(),
};

const activity = {
  params: z.object({ executiveId: id }),
  query: paging,
};

const allActivity = {
  query: paging.extend({
    action: z.string().trim().max(80).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
};

module.exports = {
  listExecutives, executiveParam, createExecutive, updateExecutive,
  resetPassword, setStatus, activity, allActivity,
};
