'use strict';

const { sitePolicy, entitlements } = require('@ibitplay/common');

const E = require('./email.errors');

/**
 * The owner's `deposit_email_verification` policy: with `required`, no deposit entry point
 * (fiat, payment orders, crypto address, P2P buy) goes ahead for a player whose
 * `users.email_verified_at` is NULL — 403 EMAIL_NOT_VERIFIED, before anything else is done.
 * `none` (the default), or the policy out of the owner's plan: nothing changes.
 *
 * The site admin's old `require_email_verification` setting (nothing read it) is gone: the
 * owner alone decides this.
 */
const POLICY = 'deposit_email_verification';

async function required(models) {
  if (!(await entitlements.isFeatureEntitled(POLICY))) return false;
  return (await sitePolicy.readPolicy(models, POLICY)) === 'required';
}

async function assertDepositEmailVerified(models, userId) {
  if (!(await required(models))) return;
  const user = await models.Users.findByPk(userId, { attributes: ['email_verified_at'], raw: true });
  if (!user?.email_verified_at) throw E.NOT_VERIFIED();
}

/** Route guard, next to `denyAgentPlayer('deposit')`. */
function requireDepositEmail(models) {
  return async function requireDepositEmailMiddleware(req, _res, next) {
    try {
      if (req.user) await assertDepositEmailVerified(models, req.user.id);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { POLICY, required, assertDepositEmailVerified, requireDepositEmail };
