import { categoryLabel } from '@/data/categories';

/**
 * The play page's shared metric builders — deliberately its own module rather
 * than exports from a component file, so fast refresh keeps applying to the
 * components and these stay pure functions (see `GameStats.jsx`).
 */

/**
 * A percent/number that rounds rather than pads: `96` stays `96`, `96.53`
 * stays `96.53`, and `20.00` approaches `20`. The numbers arrive as numerics
 * from `num()` in the adapter, so a two-zero tail only means the data carried
 * one.
 */
export function fmt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return String(Math.round(number * 100) / 100);
}

/** Every figure the page can honestly print for a game, label first. */
export function gameMetrics(game) {
  const rows = [];
  rows.push(['Provider', game.provider]);
  if (game.category) rows.push(['Game type', categoryLabel(game.category)]);
  if (game.rtp !== undefined) rows.push(['RTP', `${fmt(game.rtp)}%`]);
  if (game.volatility) rows.push(['Volatility', capitalize(game.volatility)]);
  if (game.hitRatio !== undefined) rows.push(['Hit frequency', `${fmt(game.hitRatio)}%`]);
  if (game.bonusBuy) rows.push(['Bonus buy', 'Available']);
  return rows;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}