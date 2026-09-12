'use strict';

const { z } = require('@ibitplay/common');

const { ROLE } = require('./club.constants');

const id = z.coerce.number().int().positive();
const code = z.string().trim().toUpperCase().min(4).max(50).regex(/^[A-Z0-9]+$/);
const percentage = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'must be a percentage like "12.5"');

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const createClub = {
  body: z
    .object({
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(1000).optional(),
      maxMembers: z.coerce.number().int().min(1).max(100_000).optional(),
      parentClubId: id.optional(),
    })
    .strict(),
};

const updateClub = {
  params: z.object({ clubId: id }),
  body: z
    .object({
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      maxMembers: z.coerce.number().int().min(1).max(100_000).optional(),
      isActive: z.coerce.boolean().optional(),
    })
    .strict(),
};

const clubParam = { params: z.object({ clubId: id }) };

/**
 * A club addressed by its OWNER.
 *
 * Legacy spelled this `/clubmembership/userprofile/:userId` — an unauthenticated
 * route with the player named in the URL.
 */
const ownerParam = { params: z.object({ ownerId: id }) };

/** Join by one code or the other. No `userId` — legacy took it from the body. */
const join = {
  body: z
    .object({ clubCode: code.optional(), agentCode: code.optional() })
    .strict()
    .refine((v) => Boolean(v.clubCode) !== Boolean(v.agentCode), {
      message: 'give exactly one of clubCode or agentCode',
    }),
};

/**
 * A role change names the MEMBER, not the actor.
 *
 * Legacy took `userId`, `clubId` and `newRole` from the body with no
 * authentication, so a player could promote themselves to agent.
 */
const changeRole = {
  body: z.object({ userId: id, newRole: z.enum([ROLE.AGENT, ROLE.MEMBER]) }).strict(),
};

const listMembers = {
  params: z.object({ clubId: id }),
  query: paging.extend({ role: z.enum([ROLE.OWNER, ROLE.AGENT, ROLE.MEMBER]).optional() }),
};

const earningsConfig = {
  params: z.object({ clubId: id }),
  body: z
    .object({
      configurationType: z.string().trim().max(50).optional(),
      ownerPercentage: percentage.optional(),
      agentPercentage: percentage.optional(),
      memberPercentage: percentage.optional(),
      activePlayerThreshold: z.coerce.number().int().min(0).max(1_000_000).optional(),
      wagerThreshold: z.string().trim().regex(/^\d+(\.\d{1,2})?$/).optional(),
    })
    .strict(),
};

const earningsLog = {
  params: z.object({ clubId: id }),
  query: paging.extend({ paid: z.coerce.boolean().optional() }),
};

const listClubs = {
  query: paging.extend({
    search: z.string().trim().max(120).optional(),
    ownerId: id.optional(),
    activeOnly: z.coerce.boolean().optional(),
  }),
};

module.exports = {
  createClub, updateClub, clubParam, ownerParam, join, changeRole,
  listMembers, earningsConfig, earningsLog, listClubs,
};
