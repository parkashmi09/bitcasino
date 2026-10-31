'use strict';

/**
 * The smallest tip per currency. Fiat coins have a whole-unit floor (INR 1);
 * USD stablecoins a cent; anything else the wallet's smallest unit (8 dp).
 */
const FIAT_MINIMUM = '1';
const STABLE_MINIMUM = '0.01';
const SMALLEST_UNIT = '0.00000001';

const MINIMUMS = Object.freeze({
  INR: FIAT_MINIMUM,
  MVR: FIAT_MINIMUM,
  AED: FIAT_MINIMUM,
  NPR: FIAT_MINIMUM,
  PKR: FIAT_MINIMUM,
  EUR: FIAT_MINIMUM,
  BDT: FIAT_MINIMUM,
  USDT: STABLE_MINIMUM,
  USDC: STABLE_MINIMUM,
  BUSD: STABLE_MINIMUM,
  TUSD: STABLE_MINIMUM,
  USDP: STABLE_MINIMUM,
});

const minimumFor = (currency) => MINIMUMS[String(currency).toUpperCase()] ?? SMALLEST_UNIT;

/** At most this many tips per sender per rolling window. */
const RATE_LIMIT = Object.freeze({ max: 20, windowMs: 60 * 60 * 1000 });

/** How many usernames the recipient picker suggests. */
const SEARCH_LIMIT = 8;

module.exports = { MINIMUMS, minimumFor, RATE_LIMIT, SEARCH_LIMIT };
