/* Presentational helpers for the exchange kit. Plain functions only — no components here, so
 * `react-refresh/only-export-components` stays happy (same split as `pages/Sports/sportArt.js`).
 *
 * These are DEFAULTS. Every component that formats a number takes the formatter as a prop, so the
 * data layer (`src/utils/exchange/`) can hand in its own and this file never becomes the source
 * of truth for money or ladder rules. */

export const cx = (...parts) => parts.filter(Boolean).join(' ');

const trim = (v) => (v % 1 === 0 ? String(v) : String(Number(v.toFixed(2))));

/* 1500 -> "1.5K", 250000 -> "2.5L", 0/empty -> ''. The Indian-exchange convention (TENEXCH's
   `formatSize`): K for thousands, L (lakh) from 1,00,000. */
export function formatSize(size) {
  const n = Number(size);
  if (!size || Number.isNaN(n) || n === 0) return '';
  if (n >= 100000) return `${trim(n / 100000)}L`;
  if (n >= 1000) return `${trim(n / 1000)}K`;
  return trim(n);
}

/* Money readout. Two decimals, grouped. */
export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Signed P&L: "+120.00" / "−80.00" (a real minus sign, U+2212, so the column lines up). */
export function formatSigned(value, fmt = formatAmount) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return fmt(0);
  return `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
}

/* Price as printed in a cell: up to two decimals, no padding (1.9 not 1.90; 42 not 42.00). */
export function formatPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return '';
  return trim(n);
}

/* The Betfair price ladder — the default for the slip's −/+ stepper when the wiring layer does
   not pass its own `stepPrice`. */
const LADDER = [
  [2, 0.01],
  [3, 0.02],
  [4, 0.05],
  [6, 0.1],
  [10, 0.2],
  [20, 0.5],
  [30, 1],
  [50, 2],
  [100, 5],
  [1000, 10],
];

export function stepPrice(price, direction) {
  let p = Number(price) || 1.01;
  const tickAt = (v, dir) => {
    for (const [ceil, tick] of LADDER) {
      if (dir > 0 ? v < ceil : v <= ceil) return tick;
    }
    return 10;
  };
  const tick = tickAt(p, direction);
  p = direction > 0 ? p + tick : p - tick;
  p = Math.round(p / tick) * tick;
  return Math.min(1000, Math.max(1.01, Number(p.toFixed(2))));
}

/* Profit / liability for a stake. Back: win stake×(price−1), risk stake. Lay: the mirror.
   Fancy (`isLine`) prices are runs and the rate is per 100: Yes wins stake×rate/100 and risks
   the stake; No wins the stake and risks stake×rate/100. */
export function calcProfitLiability({ side, price, stake, rate, isLine = false }) {
  const s = Number(stake) || 0;
  if (isLine) {
    const r = (Number(rate) || 100) / 100;
    return side === 'back' || side === 'yes'
      ? { profit: s * r, liability: s }
      : { profit: s, liability: s * r };
  }
  const p = Number(price) || 0;
  const edge = Math.max(0, p - 1) * s;
  return side === 'back' ? { profit: edge, liability: s } : { profit: s, liability: edge };
}

/* "Today 19:30" / "14 Oct 19:30" from an ISO string, Date or epoch ms. A string that does not
   parse is returned as-is, so a caller can pass a ready label. */
export function formatStartTime(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const now = new Date();
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `Today ${hm}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${hm}`;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${hm}`;
}

/* Normalised runner/row status. Anything that is not ACTIVE/OPEN suspends the row, and the label
   is the feed's own word ("BALL RUNNING", "SUSPENDED", "CLOSED"). */
export function statusLabel(status) {
  if (!status) return null;
  const s = String(status).toUpperCase().replace(/_/g, ' ');
  return s === 'ACTIVE' || s === 'OPEN' ? null : s;
}

/** Indian compact amount, as TENEXCH prints limits and bhav: 100 · 25K · 1L · 2.5L · 1Cr. */
export function compactAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '0';
  const unit = (v, s) => (v % 1 === 0 ? String(v) : String(Number(v.toFixed(2)))) + s;
  const a = Math.abs(n);
  if (a >= 1e7) return unit(n / 1e7, 'Cr');
  if (a >= 1e5) return unit(n / 1e5, 'L');
  if (a >= 1e3) return unit(n / 1e3, 'K');
  return String(n);
}

/** A row's stake range as TENEXCH prints it beside a fancy / khado / odd-even row: "Min:100 Max:2L". */
export const limitsText = (min, max, fmt = compactAmount) => `Min:${fmt(min || 0)} Max:${fmt(max || 0)}`;

/** A runner's book as TENEXCH prints it under the name (formatBookValue): en-IN grouping from
 *  1,000, else up to 2 dp, "-" for a loss and no "+" — "-11", "20", "4,500", "-120". */
export function formatBook(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const a = Math.abs(n);
  const text = a >= 1000 ? a.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(Math.round(a * 100) / 100);
  return n < 0 && text !== '0' ? `-${text}` : text;
}
