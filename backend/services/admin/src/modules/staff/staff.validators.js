'use strict';

const { z } = require('@ibitplay/common');

const { TRANSFER_DIRECTIONS, TARGET_TYPES } = require('./staff.constants');

const id = z.coerce.number().int().positive();

/**
 * Money as a string, always. Legacy compared `amount > bal` with `amount`
 * straight from the body — a float comparison against a NUMERIC column.
 */
const amount = z
  .string({ invalid_type_error: 'send the amount as a string, not a number' })
  .trim()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a positive decimal with at most 8 decimal places')
  .refine((v) => Number.parseFloat(v) > 0, 'amount must be greater than zero');

/**
 * A staff password.
 *
 * Length is the property that matters and the only one enforced — composition
 * rules push people towards `Password1!` and away from length. Legacy enforced
 * nothing at all, and then stored the result in cleartext beside the hash.
 */
const password = z.string().min(8, 'must be at least 8 characters').max(200);

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
      // Required for agent-tree callers, and for anyone once they have set
      // one — see `staff-auth/transactionPassword.js`.
      transactionPassword: z.string().min(1).max(200).optional(),
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
      // A forced change may CHOOSE its transaction password (whitelabel company's first login)
      // instead of being issued a random one. 6 digits, like the issued ones.
      transactionPassword: z.string().regex(/^\d{6}$/, 'must be 6 digits').optional(),
    })
    .strict()
    .refine((v) => v.targetId !== undefined || v.oldPassword !== undefined, {
      message: 'changing your own password requires the current one',
      path: ['oldPassword'],
    }),
};

module.exports = { transfer, changePassword };
