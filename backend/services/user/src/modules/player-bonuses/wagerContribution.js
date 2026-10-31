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
/* A provider is matched on its letters and digits with a trailing "gaming" / "games" / version
   number dropped: the seeded names ("pg soft", "hacksaw") and the catalogue's ("PGSoft",
   "Hacksaw Gaming", "Platipus2") then meet. */
const providerKey = (value) => norm(value).replace(/[^a-z0-9]/g, '').replace(/(gaming|games|\d+)$/, '');

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
      else if (r.provider) byProvider.set(providerKey(r.provider), pct);
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
  return byGame.get(norm(gameRef)) ?? byProvider.get(providerKey(provider)) ?? byCategory.get(norm(category)) ?? '1';
}

/** Admin edits: drop the cache. */
function clearContributionCache() {
  cache = { at: 0, rules: null };
  tableCache = { at: 0, table: null };
}

let tableCache = { at: 0, table: null };
const TYPES = ['slots', 'originals', 'live', 'sports'];

/**
 * What the player is shown (Bonus page, promotion page): the % each game type, provider and game
 * counts toward a locked bonus, games with their catalogue name and art. A type with no rule
 * counts 100%, as `contributionFor` does. Cached 60 s.
 */
async function contributionTable(sequelize) {
  if (tableCache.table && Date.now() - tableCache.at < TTL_MS) return tableCache.table;
  const rows = await sequelize.query(
    `SELECT w.category, w.provider, w.game_ref, w.percent::float8 AS percent,
            COALESCE(o.name, g.name, j.game_name) AS name,
            CASE WHEN o.code IS NOT NULL OR lower(j.vendor) IN ('in-house', 'inhouse') THEN 'Originals'
                 ELSE COALESCE(g.provider, j.vendor) END AS game_provider,
            COALESCE(g.image, j.game_icon) AS image
       FROM wager_contribution w
       LEFT JOIN LATERAL (SELECT name, provider, image FROM gisgamesnew WHERE uuid = w.game_ref LIMIT 1) g ON w.game_ref IS NOT NULL
       LEFT JOIN LATERAL (SELECT game_name, vendor, game_icon FROM js_games WHERE lower(game_uid) = w.game_ref LIMIT 1) j ON w.game_ref IS NOT NULL
       LEFT JOIN LATERAL (SELECT code, name FROM og_games WHERE lower(code) = w.game_ref LIMIT 1) o ON w.game_ref IS NOT NULL`,
    { type: QueryTypes.SELECT }
  );
  const types = Object.fromEntries(TYPES.map((t) => [t, rows.find((r) => r.category === t)?.percent ?? 100]));
  const table = {
    types,
    providers: rows.filter((r) => r.provider).map((r) => ({ name: r.provider, percent: r.percent })),
    games: rows
      .filter((r) => r.game_ref)
      .map((r) => ({ ref: r.game_ref, name: r.name ?? r.game_ref, provider: r.game_provider ?? null, image: r.image ?? null, percent: r.percent }))
      .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name)),
    minSportsOdds: MIN_SPORTS_ODDS,
  };
  tableCache = { at: Date.now(), table };
  return table;
}

module.exports = { contributionFor, contributionTable, clearContributionCache, providerKey, MIN_SPORTS_ODDS };
