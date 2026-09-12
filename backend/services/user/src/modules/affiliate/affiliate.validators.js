'use strict';

const { z } = require('@ibitplay/common');

const { moneyAmount } = require('../wallet/wallet.validators');

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Referral codes are short, printable, and appear in URLs. */
const referralCode = z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/);
const playerName = z.string().trim().min(1).max(120);

/** No `uid` or `userId` — legacy took it from the body on every claim route. */
const myPaging = { query: paging };

const joinTeam = { body: z.object({ referralCode }).strict() };

const claimReward = {
  body: z.object({ rewardId: z.coerce.number().int().positive() }).strict(),
};

// ── Staff ─────────────────────────────────────────────────────────────

const listTeams = { query: paging.extend({ search: z.string().trim().max(120).optional() }) };

const teamMembers = { params: z.object({ owner: playerName }), query: paging };

const listRewards = {
  query: paging.extend({
    claimed: z.coerce.boolean().optional(),
    owner: playerName.optional(),
  }),
};

const topAffiliates = { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) };

/**
 * Unlocking names a MEMBER, not an amount.
 *
 * The legacy endpoint took `wagerAmount` from the body and chose the reward
 * tier from it, so the caller picked their own prize. The wager is read from
 * `userwager` here and there is deliberately no parameter for it.
 */
const unlock = { body: z.object({ memberName: playerName }).strict() };

const recordReward = {
  body: z
    .object({
      ownerName: playerName,
      memberName: playerName,
      referralCode,
      amount: moneyAmount,
      coin: z.string().trim().max(10).optional(),
    })
    .strict(),
};

/**
 * A player's own reward list, optionally narrowed to today.
 *
 * `filter` is legacy's spelling (`?filter=today`) and only `today` did anything
 * — every other value fell through to "all". Enumerated rather than accepted
 * loosely, so `?filter=tody` is a 422 instead of silently showing everything.
 */
const myRewards = {
  query: paging.extend({ filter: z.enum(['today', 'all']).default('all') }),
};

module.exports = {
  myPaging, myRewards, joinTeam, claimReward,
  listTeams, teamMembers, listRewards, topAffiliates, unlock, recordReward,
};
