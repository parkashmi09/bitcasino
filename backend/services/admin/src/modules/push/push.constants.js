'use strict';

/** 1 MB — OneSignal recommends small images; Chrome drops slow ones. */
const MAX_IMAGE_BYTES = 1024 * 1024;
/** Chrome's big-picture box is 2:1; 1440x720 is the recommended size. */
const RECOMMENDED_IMAGE = Object.freeze({ width: 1440, height: 720, ratio: 2 });

const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/** How many players one campaign may write inbox rows for / push to by id. */
const MAX_CAMPAIGN_PLAYERS = 200_000;

/**
 * The automatic event pushes and their built-in copy — the same words the
 * user-service call sites send (services/user/src/modules/…/notifyPlayer
 * calls). An operator row in `push_templates` overrides title/body/image/url
 * or switches the push off for that event; no row = this copy.
 *
 * Placeholders are filled from the event's `meta`: {amount} is the formatted
 * figure with its currency; every other `{key}` is `meta[key]`.
 */
const TEMPLATE_KINDS = Object.freeze([
  { kind: 'deposit_approved', group: 'Deposits', label: 'Deposit approved', title: 'Deposit approved', body: '{amount} has been added to your wallet (deposit #{depositId}).', url: '/#transactions', placeholders: ['amount', 'currency', 'depositId'] },
  { kind: 'deposit_rejected', group: 'Deposits', label: 'Deposit rejected', title: 'Deposit rejected', body: 'Your {amount} deposit #{depositId} was rejected. Reason: {reason}', url: '/#transactions', placeholders: ['amount', 'currency', 'depositId', 'reason'] },
  { kind: 'deposit_credited', group: 'Deposits', label: 'Crypto / PSP deposit credited', title: 'Deposit received', body: '{amount} has been credited to your wallet.', url: '/#transactions', placeholders: ['amount', 'currency', 'reference'] },
  { kind: 'deposit_failed', group: 'Deposits', label: 'Crypto / PSP deposit failed', title: 'Deposit failed', body: 'Your {amount} deposit did not go through. Nothing was credited.', url: '/#transactions', placeholders: ['amount', 'currency', 'reference'] },
  { kind: 'withdrawal_approved', group: 'Withdrawals', label: 'Withdrawal approved', title: 'Withdrawal approved', body: 'Your {amount} withdrawal #{withdrawalId} was approved and is being paid out.', url: '/#transactions', placeholders: ['amount', 'currency', 'withdrawalId'] },
  { kind: 'withdrawal_paid', group: 'Withdrawals', label: 'Withdrawal paid', title: 'Withdrawal paid', body: 'Your {amount} withdrawal has been sent.', url: '/#transactions', placeholders: ['amount', 'currency', 'withdrawalId', 'reference'] },
  { kind: 'withdrawal_rejected', group: 'Withdrawals', label: 'Withdrawal rejected / failed', title: 'Withdrawal rejected', body: 'Your {amount} withdrawal was rejected and the funds are back in your wallet.', url: '/#transactions', placeholders: ['amount', 'currency', 'withdrawalId', 'reason'] },
  { kind: 'kyc_approved', group: 'KYC', label: 'KYC approved', title: 'Identity verified', body: 'Your KYC documents were approved. Withdrawals are now open to you.', url: '/settings', placeholders: [] },
  { kind: 'kyc_rejected', group: 'KYC', label: 'KYC rejected', title: 'Identity verification rejected', body: 'Your KYC documents were not accepted. Reason: {reason}. Please submit them again.', url: '/settings', placeholders: ['reason'] },
  { kind: 'vip_level_up', group: 'VIP', label: 'VIP level-up', title: 'VIP level {level} reached', body: '{amount} VIP reward has been added to your wallet.', url: '/vip', placeholders: ['amount', 'currency', 'level'] },
  { kind: 'vip_rank_up', group: 'VIP', label: 'VIP rank-up', title: 'New VIP rank: {card}', body: '{amount} VIP reward has been added to your wallet.', url: '/vip', placeholders: ['amount', 'currency', 'card', 'level'] },
  { kind: 'first_deposit_bonus', group: 'Bonuses', label: 'First-deposit bonus', title: 'First deposit bonus', body: '{amount} first deposit bonus has been added to your wallet.', url: '/bonus', placeholders: ['amount', 'currency'] },
  { kind: 'bonus_credited', group: 'Bonuses', label: 'Bonus / reward credited (claims, codes, gift cards, rakeback, race)', title: 'Bonus credited', body: '{amount} has been added to your wallet.', url: '/bonus', placeholders: ['amount', 'currency'] },
  { kind: 'free_spins', group: 'Bonuses', label: 'Casino free spins (added / won)', title: 'Free spins', body: 'Your free spins are ready.', url: '/casino', placeholders: [] },
  { kind: 'affiliate_commission', group: 'Affiliate', label: 'Affiliate commission', title: 'Affiliate commission available', body: 'Your referrals earned you commission. Claim it from the Affiliate page.', url: '/affiliate', placeholders: ['amount', 'currency'] },
  { kind: 'affiliate_reward', group: 'Affiliate', label: 'Affiliate reward', title: 'Referral bonus unlocked', body: '{amount} is ready to claim.', url: '/affiliate', placeholders: ['amount', 'currency'] },
]);

const TEMPLATE_BY_KIND = new Map(TEMPLATE_KINDS.map((t) => [t.kind, t]));

/** The soft-ask ("allow notifications") popup the front end shows. Every word is the operator's. */
const PROMPT_DEFAULTS = Object.freeze({
  enabled: true,
  title: 'Never miss a win',
  text: 'Turn on notifications for deposits, withdrawals, bonuses and VIP rewards the moment they happen.',
  allowLabel: 'Allow',
  laterLabel: 'Not now',
  /** after_login: N seconds after a signed-in visit; after_first_deposit: once the player has deposited. */
  trigger: 'after_login',
  delaySeconds: 20,
  cooldownDays: 7,
});

const SETTINGS_DEFAULTS = Object.freeze({
  /** Where OneSignal fetches uploaded images and where relative click URLs point. Empty = env. */
  publicOrigin: '',
  /** The OneSignal segment "every subscriber" means on this app. */
  allSegment: 'Total Subscriptions',
  /** Default icon for every push (https). Empty = the icon set in the OneSignal dashboard. */
  defaultIconUrl: '',
  /** The chime the player site plays when a push arrives while it is open: an upload (served at
   *  /api/v1/admin/push/sound/…) or an https URL. Empty = the site's own /sounds/notify.mp3. */
  soundUrl: '',
});

/** A notification sound is a second or two; 300 KB is far more than an MP3 chime needs. */
const MAX_SOUND_BYTES = 300 * 1024;

module.exports = {
  MAX_IMAGE_BYTES,
  RECOMMENDED_IMAGE,
  CAMPAIGN_STATUS,
  MAX_CAMPAIGN_PLAYERS,
  TEMPLATE_KINDS,
  TEMPLATE_BY_KIND,
  PROMPT_DEFAULTS,
  SETTINGS_DEFAULTS,
  MAX_SOUND_BYTES,
};
