'use strict';

const { Op, fn, col, where: whereExpr } = require('sequelize');

/**
 * The site admin's provider switch, as the reads and the launch guard see it.
 *
 * `casino_provider_settings` (migration 067) holds a row only for a provider
 * somebody has touched; no row is enabled. So the question every read asks is
 * the short one — which providers are OFF — and the answer is a handful of
 * names out of a tiny table, read fresh each time: a switch that takes a
 * cache's lifetime to bite is a switch the operator flips twice.
 */

/** The catalogue's name as the settings table keys it. */
const providerKey = (name) => String(name ?? '').trim().toLowerCase();

/** Letters and digits only — how the launch guard matches a vendor name another route spells differently. */
const looseKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Lowercased names of the providers switched off. Empty when the table is missing or empty. */
async function disabledProviders(models) {
  if (!models?.CasinoProviderSetting) return [];
  const rows = await models.CasinoProviderSetting.findAll({
    where: { enabled: false },
    attributes: ['provider'],
    raw: true,
  });
  return rows.map((r) => providerKey(r.provider)).filter(Boolean);
}

/**
 * A `where` fragment that leaves out every game of a disabled provider.
 *
 * A game with no provider is kept: it belongs to nobody an operator can switch
 * off, and `LOWER(NULL) NOT IN (…)` would otherwise drop it silently.
 */
function excludeDisabled(disabled, column = 'provider') {
  if (!disabled.length) return null;
  return {
    [Op.or]: [{ [column]: null }, whereExpr(fn('LOWER', fn('BTRIM', col(column))), { [Op.notIn]: disabled })],
  };
}

/** Merge the exclusion into a `where` without disturbing the filters already in it. */
function withoutDisabled(where, disabled, column) {
  const clause = excludeDisabled(disabled, column);
  if (!clause) return where;
  return { ...where, [Op.and]: [...(where[Op.and] ?? []), clause] };
}

/** Is this provider (any spelling) switched off? */
async function isProviderDisabled(models, name) {
  const wanted = looseKey(name);
  if (!wanted) return false;
  const disabled = await disabledProviders(models);
  return disabled.some((p) => looseKey(p) === wanted);
}

/**
 * A player's own list (favourites, recently played) without the games of a switched-off
 * provider. Matched loosely, as the launch guard does, because an in-house row names its
 * vendor in its own spelling. An entry whose game did not resolve is kept: there is no
 * provider to judge it by, and the list keeps unresolved rows on purpose.
 */
function withoutDisabledGames(entries, disabled, gameOf = (entry) => entry.game) {
  if (!disabled.length) return entries;
  const off = new Set(disabled.map(looseKey));
  return entries.filter((entry) => {
    const provider = gameOf(entry)?.provider;
    return !provider || !off.has(looseKey(provider));
  });
}

module.exports = {
  providerKey,
  looseKey,
  disabledProviders,
  excludeDisabled,
  withoutDisabled,
  withoutDisabledGames,
  isProviderDisabled,
};
