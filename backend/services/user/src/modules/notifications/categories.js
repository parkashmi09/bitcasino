'use strict';

/**
 * The tabs of the player's notification panel, and which stored `type`s each
 * one shows.
 *
 * A row's `type` is either a staff send's type (`general`, `deposit`,
 * `withdrawal`, `bonus`, `bet`, `promotion` — admin-service's
 * NOTIFICATION_TYPES), a push campaign (`promotion`), or the `kind` of an
 * account event that `notifyPlayer` wrote (`deposit_approved`, …). The panel
 * groups them the way the player thinks about them:
 *
 *   system      notices from the site to everyone (staff sends / broadcasts
 *               of type `general`)
 *   transactions what happened to THIS account: deposits, withdrawals, KYC,
 *               bets, VIP and affiliate events
 *   promotions  offers: push campaigns and staff sends of type `promotion` /
 *               `bonus`, and the bonus events
 *
 * `transactions` is "everything that is not system or promotions", so a kind added
 * later lands somewhere sensible without a change here.
 */
const SYSTEM_TYPES = Object.freeze(['general']);
const PROMOTION_TYPES = Object.freeze([
  'promotion',
  'bonus',
  'campaign',
  'first_deposit_bonus',
  'spin_wheel_bonus',
  'bonus_unlocked',
  // Every bonus / reward credit and casino free spins (notifyBonus, casino gis), and the VIP / referral rewards.
  'bonus_credited',
  'free_spins',
  'vip_level_up',
  'vip_rank_up',
  'affiliate_reward',
  'affiliate_commission',
]);

/**
 * What an agent-tree player never sees (`AGENT_PLAYER_RESTRICTIONS.promotions`
 * in @ibitplay/auth): every offer, plus the reward events of sections they
 * cannot use (VIP, affiliate). They cannot earn those, so a row of one would
 * only be an old one or an operator's mistake — either way an offer they are
 * not allowed to take.
 */
const AGENT_HIDDEN_TYPES = Object.freeze([
  ...PROMOTION_TYPES,
  'vip_level_up',
  'vip_rank_up',
  'level_up',
  'rank_up',
  'affiliate_reward',
  'affiliate_commission',
]);

const CATEGORY_NAMES = Object.freeze(['all', 'system', 'transactions', 'promotions']);

/** The `{ types, excludeTypes }` filter admin-service's history takes for a tab. */
function filterFor(category, { agentPlayer = false } = {}) {
  const hidden = agentPlayer ? [...AGENT_HIDDEN_TYPES] : [];
  switch (category) {
    case 'system':
      return { types: [...SYSTEM_TYPES], excludeTypes: hidden };
    case 'promotions':
      // Nothing to show an agent-tree player: the caller answers empty.
      return agentPlayer ? null : { types: [...PROMOTION_TYPES], excludeTypes: [] };
    case 'transactions':
      return { types: [], excludeTypes: [...new Set([...SYSTEM_TYPES, ...PROMOTION_TYPES, ...hidden])] };
    default:
      return { types: [], excludeTypes: hidden };
  }
}

/** Which tab a stored type belongs to. */
function categoryOf(type) {
  const t = type ?? 'general';
  if (SYSTEM_TYPES.includes(t)) return 'system';
  if (PROMOTION_TYPES.includes(t)) return 'promotions';
  return 'transactions';
}

module.exports = { SYSTEM_TYPES, PROMOTION_TYPES, AGENT_HIDDEN_TYPES, CATEGORY_NAMES, filterFor, categoryOf };
