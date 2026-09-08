/** Compact currency used by jackpot counters and balance chips. */
export function formatCurrency(value, currency = 'USDT') {
  const n = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${n} ${currency}`;
}

export function formatCompact(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * A wallet balance, formatted without ever becoming a Number.
 *
 * Balances arrive as decimal STRINGS — `"1534.479999999999986"` is a real row —
 * because the column is `NUMERIC(30,8)` and a double cannot carry it. Parsing
 * one to format it is how a balance quietly changes value on the way to the
 * screen, so this works on the digits: split at the point, group the integer
 * part by hand, then pad or CUT the fraction to the currency's display
 * precision.
 *
 * Cut, not round: rounding up would show a player more money than they hold.
 */
export function formatBalance(value, decimals = 2) {
  const text = String(value ?? '0').trim();
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace(/^[-+]/, '').split('.');

  const digits = whole.replace(/\D/g, '') || '0';
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const scaled = fraction.replace(/\D/g, '').slice(0, decimals).padEnd(decimals, '0');

  return `${negative && /[1-9]/.test(digits + scaled) ? '-' : ''}${grouped}${
    decimals > 0 ? `.${scaled}` : ''
  }`;
}

/**
 * The footer's `1 USDT = 94.779 INR` pair.
 *
 * `rate` is the target currency's `usdRate` as `GET /user/exchange-rate/rates`
 * answers it: a decimal STRING, because the column is one and a float is not.
 * It is parsed exactly once, here, to format a display string — never to carry
 * a balance, which is the rule `formatBalance` follows for the same reason.
 *
 * USDT is quoted rather than USD because it is the platform's account default
 * and what every fiat rail settles into, and it tracks the dollar 1:1 — so the
 * dollar rate IS the USDT rate. Quoting `USD` against `USD` would print
 * `1 USD = 1 USD`, which the fallback below does deliberately: with no rate to
 * hand, saying nothing more than the identity is better than printing a number
 * nobody answered.
 */
export function fiatPair(fiat, rate) {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed) || parsed <= 0) return `1 USDT = 1 USD`;

  // Up to three places, trailing zeros dropped — `94.779`, but `1.5` not
  // `1.500`. `en-US` is pinned so the separator does not follow the visitor's
  // locale into a string the rest of the footer writes in English.
  const amount = parsed.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return `1 USDT = ${amount} ${fiat}`;
}

/**
 * The grey second line under a balance in the wallet drawer — `₹0.00` beside
 * `0.00 USDT` on the reference.
 *
 * This one DOES parse the balance, which everything above refuses to do, and
 * the difference is deliberate: it is a conversion, so it is already an
 * approximation the moment a rate is applied, and the exact figure it sits
 * under is the one formatted from the digits by `formatBalance`. A float here
 * can move the last cent of a quote; it cannot move the balance, because the
 * balance is rendered separately and never from this.
 *
 * Both rates carry `usdRate` as `GET /user/exchange-rate/rates` answers it:
 * units of that currency per one US dollar — the reading `fiatPair` uses when
 * it prints `1 USDT = 94.779 INR`. So the value goes through the dollar:
 * `usd = amount / fromRate`, then `usd * toRate`.
 *
 * Answers `null` — not a zero, and not the unconverted number — when either
 * leg is missing. A quote nobody supplied a rate for is worse than no quote.
 */
export function formatFiat(value, fromRate, toRate, fiat) {
  const amount = Number(String(value ?? '0').replace(/[^\d.-]/g, ''));
  const from = Number(fromRate);
  const to = Number(toRate);

  if (!Number.isFinite(amount)) return null;
  if (!Number.isFinite(from) || from <= 0) return null;
  if (!Number.isFinite(to) || to <= 0) return null;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: fiat,
      maximumFractionDigits: 2,
    }).format((amount / from) * to);
  } catch {
    // An ISO code `Intl` does not know. The number is still worth showing.
    return `${((amount / from) * to).toFixed(2)} ${fiat}`;
  }
}
