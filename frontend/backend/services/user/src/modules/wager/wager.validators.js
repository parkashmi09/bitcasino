'use strict';

const { z } = require('@ibitplay/common');

/**
 * The multiplier is a decimal (2.5x is a real setting), so it is carried as a
 * string like every other number that participates in money arithmetic.
 * `wager_multiplier_common.multiplier` is an INTEGER column in the schema,
 * which cannot hold 2.5 — see wager.service.js.
 */
const multiplier = z
  .string({ required_error: 'multiplier is required' })
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'multiplier must be a positive decimal')
  .refine((v) => Number.parseFloat(v) > 0 && Number.parseFloat(v) <= 100, 'multiplier must be between 0 and 100');

const userParam = { params: z.object({ userId: z.coerce.number().int().positive() }) };

const setForUser = {
  params: z.object({ userId: z.coerce.number().int().positive() }),
  body: z.object({ multiplier }).strict(),
};

const setForAll = { body: z.object({ multiplier }).strict() };

const setLock = {
  params: z.object({ userId: z.coerce.number().int().positive() }),
  body: z.object({ locked: z.coerce.boolean() }).strict(),
};

/**
 * Which players the wagering screen is about.
 *
 * `users.parent_staff_id IS NULL` → a direct signup. Not null → onboarded
 * under an agent, whose wagering requirement is the agent's negotiation, not
 * the platform's. The screen exists to set the platform's own players'
 * multipliers, so it defaults to DIRECT — but it stays a filter rather than a
 * hard-coded `WHERE`, because "show me the agent players too" is a question an
 * operator is entitled to ask. `channel=all` restores the previous behaviour.
 */
const channel = z.enum(['all', 'direct', 'agent']).default('direct');

const list = {
  query: z.object({
    search: z.string().trim().max(100).optional(),
    lockedOnly: z.coerce.boolean().optional(),
    channel,
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

module.exports = { userParam, setForUser, setForAll, setLock, list, multiplier, channel };
