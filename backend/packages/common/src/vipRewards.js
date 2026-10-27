'use strict';

/**
 * VIP reward schedule — rakeback rates and bonus amounts keyed on card tier.
 *
 * The ladder in `vipLevels.js` decides *which* rank a wager buys. This file
 * decides *what that rank pays*. Kept next to the ladder so a single import
 * gives both halves of the programme, and so bonus / VIP / casino accrual
 * cannot drift onto different rate tables.
 *
 * Amounts are face values (decimal strings) in the currency they are paid in:
 * level-ups and rank-ups in `REWARD_CURRENCY` (USDT, see `currencies.js`), the
 * daily / weekly / monthly awards in the site's configurable bonus currency. Rates are fractions of USD
 * stake (so `0.002` is 0.2%), matching the figure casino-service used to
 * hard-code as `RAKEBACK_RATE`.
 */

const { VIP_LEVELS, UNRANKED } = require('./vipLevels');

/** Milliseconds in each recurring period. */
const PERIOD_MS = Object.freeze({
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
});

/**
 * How long a player has to claim an award before it expires.
 * Matches the period that earned it — a daily award lasts one day.
 */
const CLAIM_WINDOW_MS = PERIOD_MS;

/**
 * Per-card schedule.
 *
 * `rakebackRate` — fraction of USD stake accrued into Instant Rakeback.
 * `daily` / `weekly` / `monthly` — awarded into `bonus_history` when due, paid
 *   in the site's bonus currency on claim.
 * `rankUp` — USDT auto-credited the first time the player enters this card.
 * `levelUp` — USDT auto-credited for each level gained inside (or into) the card.
 */
const CARD_REWARDS = Object.freeze({
  [UNRANKED.card]: {
    rakebackRate: '0',
    daily: '0',
    weekly: '0',
    monthly: '0',
    rankUp: '0',
    levelUp: '0',
  },
  wood: {
    rakebackRate: '0.001',
    daily: '0',
    weekly: '0',
    monthly: '0',
    rankUp: '1',
    levelUp: '0.5',
  },
  bronze: {
    rakebackRate: '0.002',
    daily: '1',
    weekly: '5',
    monthly: '0',
    rankUp: '5',
    levelUp: '1',
  },
  silver: {
    rakebackRate: '0.0025',
    daily: '2',
    weekly: '10',
    monthly: '25',
    rankUp: '25',
    levelUp: '2',
  },
  gold: {
    rakebackRate: '0.003',
    daily: '5',
    weekly: '25',
    monthly: '75',
    rankUp: '75',
    levelUp: '5',
  },
  platinum: {
    rakebackRate: '0.0035',
    daily: '10',
    weekly: '50',
    monthly: '150',
    rankUp: '150',
    levelUp: '10',
  },
  jade: {
    rakebackRate: '0.004',
    daily: '15',
    weekly: '75',
    monthly: '250',
    rankUp: '250',
    levelUp: '15',
  },
  sapphire: {
    rakebackRate: '0.0045',
    daily: '25',
    weekly: '100',
    monthly: '400',
    rankUp: '400',
    levelUp: '25',
  },
  ruby: {
    rakebackRate: '0.005',
    daily: '40',
    weekly: '150',
    monthly: '600',
    rankUp: '600',
    levelUp: '40',
  },
  diamond: {
    rakebackRate: '0.006',
    daily: '60',
    weekly: '250',
    monthly: '1000',
    rankUp: '1000',
    levelUp: '60',
  },
  /* hash.game's top tier (Eternal I–X). Its amounts are not public ("Maximum Level Up, Weekly &
     Monthly Bonus"), so it starts one step above Diamond. */
  eternal: {
    rakebackRate: '0.007',
    daily: '100',
    weekly: '400',
    monthly: '1500',
    rankUp: '1500',
    levelUp: '100',
  },
});

/* Loyalty Club ladder (vipLadders.js, bitcasino + smartbet only): each level pays the matching
   platform tier's schedule, Beginner as unranked, Fan as bronze … Hero as eternal. */
const LOYALTY_CARDS = { beginner: UNRANKED.card, fan: 'bronze', expert: 'silver', master: 'gold', guru: 'platinum', legend: 'diamond', hero: 'eternal' };

/** Fallback when a player's rate has not been synced yet. Matches bronze. */
const DEFAULT_RAKEBACK_RATE = CARD_REWARDS.bronze.rakebackRate;

function rewardsForCard(card) {
  return CARD_REWARDS[card] ?? CARD_REWARDS[LOYALTY_CARDS[card]] ?? CARD_REWARDS[UNRANKED.card];
}

function rewardsForLevel(level) {
  if (!level || level <= 0) return rewardsForCard(UNRANKED.card);
  const band = VIP_LEVELS.find((b) => b.level === level);
  return rewardsForCard(band?.card ?? UNRANKED.card);
}

function rakebackRateForCard(card) {
  return rewardsForCard(card).rakebackRate;
}

function rakebackRateForLevel(level) {
  return rewardsForLevel(level).rakebackRate;
}

function periodicAmount(card, type) {
  const rewards = rewardsForCard(card);
  if (type === 'daily') return rewards.daily;
  if (type === 'weekly') return rewards.weekly;
  if (type === 'monthly') return rewards.monthly;
  return '0';
}

/** `card` matters only on the Loyalty Club ladder, whose level numbers are not the platform's. */
function levelUpAmount(level, card) {
  return (LOYALTY_CARDS[card] ? rewardsForCard(card) : rewardsForLevel(level)).levelUp;
}

function rankUpAmount(card) {
  return rewardsForCard(card).rankUp;
}

module.exports = {
  PERIOD_MS,
  CLAIM_WINDOW_MS,
  CARD_REWARDS,
  DEFAULT_RAKEBACK_RATE,
  rewardsForCard,
  rewardsForLevel,
  rakebackRateForCard,
  rakebackRateForLevel,
  periodicAmount,
  levelUpAmount,
  rankUpAmount,
};
