'use strict';

const { BadRequestError } = require('./errors');

/**
 * Money arithmetic.
 *
 * Balances are NUMERIC(30,8) in Postgres and travel as strings. Doing the maths
 * in JS floats would quietly corrupt them — 0.1 + 0.2 !== 0.3, and a casino
 * that loses a satoshi per bet loses real money. So every operation here runs
 * on BigInt "minor units" (the integer count of 10^-8 units) and only converts
 * back to a decimal string at the edges.
 */

const SCALE = 8;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** Parse a decimal string/number into BigInt minor units. Rejects junk loudly. */
function toMinor(value, { field = 'amount' } = {}) {
  if (typeof value === 'bigint') return value;

  const raw = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new BadRequestError(`${field} must be a decimal number, received "${value}"`);
  }

  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace('-', '').split('.');

  if (fraction.length > SCALE) {
    throw new BadRequestError(`${field} supports at most ${SCALE} decimal places`);
  }

  const padded = fraction.padEnd(SCALE, '0');
  const minor = BigInt(whole) * SCALE_FACTOR + BigInt(padded || '0');
  return negative ? -minor : minor;
}

/**
 * Parse a value that may carry MORE precision than the platform's scale.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * FOR READING STORED BALANCES. NEVER FOR A REQUEST BODY.
 *
 * `credits` is bare `numeric` in the baseline — no precision, no scale — so
 * Postgres has always accepted whatever arithmetic produced. Real rows carry
 * twenty decimal places (`-182800.00000000000206`), which is what an
 * accumulated float write looks like once it reaches the database.
 *
 * `toMinor` refuses those, correctly: a WRITE with more precision than the
 * platform can represent is a bug, and silently truncating it would hide the
 * bug and lose the money. But a READ has no such choice — the row already
 * exists, and a report that 400s the whole page because one stored balance is
 * over-precise is strictly worse than one that shows it to the canonical
 * scale. Both `GET /admin/reports/players` and `GET /admin/accounts` did
 * exactly that against production data.
 *
 * So this exists as a SEPARATE, NAMED function rather than a flag on `toMinor`:
 * quantising is a decision, and it should be visible at the call site which
 * side of the boundary the caller is on. Anything validating input keeps using
 * `toMinor` and keeps rejecting.
 *
 * Rounds half away from zero, so a balance is never reported as more than it is
 * in one direction and less in the other.
 * ═════════════════════════════════════════════════════════════════════════
 */
function toMinorQuantised(value, { field = 'amount' } = {}) {
  if (typeof value === 'bigint') return value;

  const raw = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new BadRequestError(`${field} must be a decimal number, received "${value}"`);
  }

  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace('-', '').split('.');

  if (fraction.length <= SCALE) return toMinor(raw, { field });

  const kept = fraction.slice(0, SCALE);
  // The first dropped digit decides the rounding, which is all half-up needs.
  const roundUp = Number(fraction[SCALE]) >= 5;

  let minor = BigInt(whole) * SCALE_FACTOR + BigInt(kept);
  if (roundUp) minor += 1n;

  return negative ? -minor : minor;
}

/**
 * A stored balance as a canonical decimal string, whatever precision it holds.
 *
 * The read-side counterpart to `toDecimalString(toMinor(x))`, which throws on
 * over-precise rows. See `toMinorQuantised`.
 */
function fromStored(value, options) {
  return toDecimalString(toMinorQuantised(value, options));
}

/** BigInt minor units -> canonical decimal string, e.g. "12.34000000". */
function toDecimalString(minor) {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / SCALE_FACTOR;
  const fraction = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

const add = (a, b) => toMinor(a) + toMinor(b);
const subtract = (a, b) => toMinor(a) - toMinor(b);

/** Multiply money by a plain multiplier (odds, payout factor, rate). */
function multiply(amount, multiplier) {
  // Carry the multiplier at the same scale, then divide the extra factor back
  // out — this keeps full precision instead of rounding the multiplier first.
  const factor = toMinor(multiplier, { field: 'multiplier' });
  return (toMinor(amount) * factor) / SCALE_FACTOR;
}

function divide(amount, divisor) {
  const factor = toMinor(divisor, { field: 'divisor' });
  if (factor === 0n) throw new BadRequestError('Cannot divide by zero');
  return (toMinor(amount) * SCALE_FACTOR) / factor;
}

/** Percentage of an amount, e.g. percentOf('100', 2.5) -> 2.50000000 */
const percentOf = (amount, percent) => divide(multiply(amount, percent), 100);

const compare = (a, b) => {
  const x = toMinor(a);
  const y = toMinor(b);
  return x === y ? 0 : x > y ? 1 : -1;
};

const isZero = (a) => toMinor(a) === 0n;
const isNegative = (a) => toMinor(a) < 0n;
const isPositive = (a) => toMinor(a) > 0n;
const gte = (a, b) => compare(a, b) >= 0;
const gt = (a, b) => compare(a, b) > 0;
const lte = (a, b) => compare(a, b) <= 0;
const lt = (a, b) => compare(a, b) < 0;
const max = (a, b) => (gte(a, b) ? toMinor(a) : toMinor(b));
const min = (a, b) => (lte(a, b) ? toMinor(a) : toMinor(b));
const negate = (a) => -toMinor(a);
const abs = (a) => (isNegative(a) ? -toMinor(a) : toMinor(a));

/** Sum a list of decimal strings. Used to reconcile a wallet against its ledger. */
const sum = (values) => values.reduce((acc, v) => acc + toMinor(v), 0n);

/** Format for display, trimming trailing zeros: "12.34000000" -> "12.34". */
function format(value, { decimals } = {}) {
  const str = typeof value === 'bigint' ? toDecimalString(value) : toDecimalString(toMinor(value));
  if (decimals !== undefined) {
    const [whole, fraction = ''] = str.split('.');
    return decimals === 0 ? whole : `${whole}.${fraction.slice(0, decimals).padEnd(decimals, '0')}`;
  }
  return str.replace(/\.?0+$/, '') || '0';
}

module.exports = {
  SCALE,
  toMinor,
  // Read-side only — see the note on the function itself.
  toMinorQuantised,
  fromStored,
  toDecimalString,
  add,
  subtract,
  multiply,
  divide,
  percentOf,
  compare,
  isZero,
  isNegative,
  isPositive,
  gte,
  gt,
  lte,
  lt,
  max,
  min,
  negate,
  abs,
  sum,
  format,
};
