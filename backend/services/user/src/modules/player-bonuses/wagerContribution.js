'use strict';

const { QueryTypes } = require('sequelize');

/**
 * How much of a bet counts toward unlocking a bonus — hash.game's "Wager Contribution for Bonus
 * Balance Details" (migration 135, edited in the site admin). Most specific rule wins: the game,
 * then its provider, then its category. Sports count only at decimal odds of 1.5 or more.
 *
 * Returns a fraction as a decimal string ("0.8" = 80%). Cached 60 s; a missing table or an
 * unreadable read counts the bet in full (the old behaviour), never zero.
 */
const TTL_MS = 60_000;
const MIN_SPORTS_ODDS = 1.5;
let cache = { at: 0, rules: null };

const norm = (value) => String(value ?? '').trim().toLowerCase();

async function rules(sequelize, logger) {
  if (cache.rules && Date.now() - cache.at < TTL_MS) return cache.rules;
  try {
    const rows = await sequelize.query('SELECT category, provider, game_ref, percent FROM wager_contribution', { type: QueryTypes.SELECT });
    const byGame = new Map();
    const byProvider = new Map();
    const byCategory = new Map();
    for (const r of rows) {
      const pct = String(Number(r.percent) / 100);
      if (r.game_ref) byGame.set(norm(r.game_ref), pct);
      else if (r.provider) byProvider.set(norm(r.provider), pct);
      else if (r.category) byCategory.set(norm(r.category), pct);
    }
    cache = { at: Date.now(), rules: { byGame, byProvider, byCategory } };
  } catch (error) {
    logger?.warn({ err: error.message }, 'wager contribution unreadable — bets count in full');
    cache = { at: Date.now(), rules: { byGame: new Map(), byProvider: new Map(), byCategory: new Map() } };
  }
  return cache.rules;
}

async function contributionFor(sequelize, { category, provider, game_ref: gameRef, odds } = {}, { logger } = {}) {
  if (category === 'sports' && odds != null && Number(odds) < MIN_SPORTS_ODDS) return '0';
  const { byGame, byProvider, byCategory } = await rules(sequelize, logger);
  return byGame.get(norm(gameRef)) ?? byProvider.get(norm(provider)) ?? byCategory.get(norm(category)) ?? '1';
}

/** Admin edits: drop the cache. */
function clearContributionCache() {
  cache = { at: 0, rules: null };
}

module.exports = { contributionFor, clearContributionCache, MIN_SPORTS_ODDS };
