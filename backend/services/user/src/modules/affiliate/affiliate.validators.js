'use strict';

const { z } = require('@ibitplay/common');

const { moneyAmount } = require('../wallet/wallet.validators');

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

/** Referral input may be the alphanumeric code or the referrer's username. */
const referralCode = z.string().trim().min(1).max(120);
const playerName = z.string().trim().min(1).max(120);

/** No `uid` or `userId` — legacy took it from the body on every claim route. */
const myPaging = { query: paging };

const campaignSlug = z.preprocess(
  (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
  z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/, 'use letters, numbers, spaces, hyphens')
    .optional()
);

const joinTeam = {
  body: z
    .object({
      referralCode,
      campaign: campaignSlug,
    })
    .strict(),
};

/** `kind` names the table: tier unlocks (default, the legacy shape) or commission. */
const claimReward = {
  body: z
    .object({
      rewardId: z.coerce.number().int().positive(),
      kind: z.enum(['tier', 'commission']).default('tier'),
    })
    .strict(),
};

/**
 * `?claimed=false` must mean false. `z.coerce.boolean()` is `Boolean(value)`,
 * and `Boolean('false')` is true — so the admin's "unclaimed" filter listed
 * the claimed rows.
 */
const queryBoolean = z.preprocess((v) => {
  if (v === undefined || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  return v;
}, z.boolean().optional());

// ── Staff ─────────────────────────────────────────────────────────────

const listTeams = { query: paging.extend({ search: z.string().trim().max(120).optional() }) };

const teamMembers = { params: z.object({ owner: playerName }), query: paging };

const listRewards = {
  query: paging.extend({
    claimed: queryBoolean,
    owner: playerName.optional(),
    kind: z.enum(['all', 'tier', 'commission']).default('all'),
  }),
};

const topAffiliates = { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() };

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

/** My Rewards → History: `referral` = level-up (tier) rewards, `commission` = commission rows. */
const rewardHistory = {
  query: paging.extend({ kind: z.enum(['referral', 'commission']).default('referral') }),
};

module.exports = {
  myPaging, myRewards, rewardHistory, joinTeam, claimReward,
  listTeams, teamMembers, listRewards, topAffiliates, unlock, recordReward,
};
