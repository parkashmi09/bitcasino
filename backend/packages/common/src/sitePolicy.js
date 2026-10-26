'use strict';

/**
 * Site policy — the business settings a site's owner chooses, enforced where
 * money and accounts are created.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A GUARD AND NOT A FLAG
 *
 * "This site takes manual deposits only" is a statement about what the
 * platform will ACCEPT, not about what a page draws. A front end that hides
 * the gateway button still leaves the gateway route one request away. So the
 * services that open a deposit, a withdrawal or an account ask here first,
 * and refuse — whatever the page showed.
 *
 * ── UNSET MEANS TODAY'S BEHAVIOUR ───────────────────────────────────────
 *
 * A site that has never chosen reads the permissive default: hybrid, both,
 * both. Shipping this must not close anybody's cashier. Only a stored choice
 * restricts.
 *
 * ── WHAT IS NEVER REFUSED HERE ──────────────────────────────────────────
 *
 * Provider callbacks, and staff approving or rejecting what is already
 * pending. Money already in flight when a mode changes must still land, and
 * a request already made must still be answerable.
 *
 * Read on every call, no cache — an operator who closes withdrawals during an
 * incident means the next request, not the one after a TTL.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { defineErrors } = require('./defineErrors');
const { assertFeatureEntitled } = require('./entitlements');

const POLICY_DEFAULTS = Object.freeze({
  business_model: 'hybrid',
  deposit_mode: 'both',
  withdrawal_mode: 'both',
  // Not a channel switch: which checks a withdrawal must pass (modules/withdraw-requirements).
  // The default is the behaviour before the policy existed — KYC Verified, no wagering check.
  withdrawal_requirements: 'kyc',
  // Not a channel switch: whose game catalogue the lobby serves (casino games/catalogueSwitch.js).
  casino_aggregator: 'js_games',
  // Not a channel switch: whether the player site offers the light theme (frontend gates.js).
  theme_mode: 'dark_only',
  // Not a channel switch: Slotegrator INR games launched in PKR (casino gis.service.js).
  slotegrator_inr_as_pkr: 'off',
  // Not a channel switch: the gateway encrypts the player site's API answers (gateway apiEncryption.js).
  api_encryption: 'off',
  // Not a channel switch: whether the rate limiters count (common middleware/rateLimit.js).
  rate_limit: 'on',
  // Not a channel switch: whether branches exist (admin modules/branches).
  branch_management: 'off',
});

/** For each policy, which stored variants allow each channel. */
const ALLOWS = Object.freeze({
  business_model: {
    // Public self-registration. Staff-created players are never refused here.
    public_signup: ['b2c', 'hybrid'],
  },
  deposit_mode: {
    manual: ['manual', 'both'],
    automatic: ['automatic', 'both'],
  },
  withdrawal_mode: {
    manual: ['manual', 'both'],
    automatic: ['automatic', 'both'],
  },
  // "Channel" = a requirement: which stored variants REQUIRE it. Read with `allows`, never
  // `assertAllowed` (a requirement in force is not a refusal of the withdrawal channel).
  withdrawal_requirements: {
    kyc: ['kyc', 'kyc_and_wager'],
    wager: ['wager', 'kyc_and_wager'],
  },
});

const errors = defineErrors('SITE_POLICY', {
  CHANNEL_CLOSED: {
    status: 403,
    message: 'This site does not offer that',
  },
});

/** Human wording for the refusal, so a player sees why rather than a code. */
const REASONS = Object.freeze({
  'business_model:public_signup': 'Sign-up is by invitation on this site. Ask your agent for an account.',
  'deposit_mode:manual': 'This site takes deposits through the payment gateway only.',
  'deposit_mode:automatic': 'This site takes manual deposits only. Submit your transfer reference instead.',
  'withdrawal_mode:manual': 'Withdrawals on this site are paid through the payment gateway.',
  'withdrawal_mode:automatic': 'Withdrawals on this site are reviewed and paid by the cashier team.',
  closed: 'This is switched off on this site.',
});

async function readPolicy(models, policy) {
  if (!(policy in POLICY_DEFAULTS)) throw new Error(`sitePolicy: unknown policy "${policy}"`);
  // A service that does not load the extended domain has no table to read —
  // it gets the permissive default rather than an error at request time.
  if (!models?.SiteFeature) return POLICY_DEFAULTS[policy];
  const row = await models.SiteFeature.findByPk(policy, { attributes: ['variant'], raw: true });
  return row?.variant ?? POLICY_DEFAULTS[policy];
}

async function allows(models, policy, channel) {
  const variant = await readPolicy(models, policy);
  const permitted = ALLOWS[policy]?.[channel];
  if (!permitted) throw new Error(`sitePolicy: unknown channel "${channel}" for "${policy}"`);
  return { allowed: permitted.includes(variant), variant };
}

/** Throw a 403 with a readable reason if this site does not offer the channel. */
async function assertAllowed(models, policy, channel, logger) {
  // A policy the owner took out of the plan is closed, whatever the site chose.
  await assertFeatureEntitled(policy);
  const { allowed, variant } = await allows(models, policy, channel);
  if (allowed) return variant;
  const reason = variant === 'none' ? REASONS.closed : REASONS[`${policy}:${channel}`] ?? REASONS.closed;
  logger?.info({ policy, channel, variant }, 'Refused by site policy');
  const error = errors.CHANNEL_CLOSED({ policy, channel, mode: variant });
  error.message = reason;
  throw error;
}

module.exports = { POLICY_DEFAULTS, ALLOWS, readPolicy, allows, assertAllowed, sitePolicyErrors: errors };
