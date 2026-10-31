'use strict';

const { fn, col, where } = require('sequelize');
const { promotionsBlocked } = require('@ibitplay/auth');

/**
 * THE ONE ANSWER TO "WHOSE REFERRAL CODE IS THIS?"
 *
 * Signup (`auth.register`), joining a team later (`affiliate.joinTeam`), the
 * joining bonus and the public "is this code valid?" check on the signup form
 * (`profile.verifyReferralCode`) all call this. They used to disagree: the
 * form check was an exact, case-sensitive match on `referalcode` while signup
 * also accepted another case and a username — so the form could say "invalid"
 * for a code signup would have honoured, and signup silently stored text the
 * form had rejected.
 *
 * Order, first hit wins:
 *   1. exact `users.referalcode`
 *   2. `referalcode`, case-folded
 *   3. `users.name`, case-folded — players share usernames as codes
 * An account with no `referalcode` of its own is never a referrer.
 *
 * CHILD USERS ARE NEVER REFERRERS. A player with ANY owner (`parent_staff_id`
 * set — see `packages/auth/src/agentPlayers.js`) is a child user, not a site
 * affiliate (affiliate is for direct users only): their code does not work anywhere. The winning match above is
 * checked with the same cached resolver the player guards use, and when it is
 * an agent-tree player the answer is "not found" — we do not fall through to
 * a later match, because the input named that player. So signup refuses the
 * code (422 `AUTH_REFERRAL_CODE_INVALID`), the public check says
 * `{ valid: false }`, joinTeam says the code is not valid and no joining
 * bonus is paid. Admin-created (parented) players are created without a code
 * (`admin/players.service.js`); codes they already hold stay in the database
 * but are inert because of this check.
 *
 * @returns {Promise<{id, name, referalcode} | null>}
 */
async function resolveReferrerOwner(models, rawInput) {
  const owner = await findReferrerCandidate(models, rawInput);
  if (!owner) return null;
  if (await promotionsBlocked(owner.id)) return null;
  return owner;
}

/** The first matching account with a code of its own — before the agent-tree check. */
async function findReferrerCandidate(models, rawInput) {
  const key = String(rawInput ?? '').trim();
  if (!key) return null;

  const attrs = ['id', 'name', 'referalcode'];

  const byExactCode = await models.Users.findOne({
    where: { referalcode: key },
    attributes: attrs,
    raw: true,
  });
  if (byExactCode?.referalcode) return byExactCode;

  const folded = key.toLowerCase();
  const byFoldedCode = await models.Users.findOne({
    where: where(fn('lower', col('referalcode')), folded),
    attributes: attrs,
    raw: true,
  });
  if (byFoldedCode?.referalcode) return byFoldedCode;

  const byName = await models.Users.findOne({
    where: where(fn('lower', col('name')), folded),
    attributes: attrs,
    raw: true,
  });
  if (byName?.referalcode) return byName;

  return null;
}

/** `${PUBLIC_SITE_URL}/referal/${code}` — the link `/user/affiliate` has always built. */
function referralLinkFor(config, referralCode) {
  if (!referralCode) return null;
  return `${String(config?.PUBLIC_SITE_URL || '').replace(/\/+$/, '')}/referal/${referralCode}`;
}

module.exports = { resolveReferrerOwner, referralLinkFor };
