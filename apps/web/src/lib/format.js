import { WALLET_DECIMALS } from '@/data/currencies';

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
 * Move a decimal STRING's point `places` to the right, without parsing it.
 *
 * Same rule as `formatBalance`: a balance is `NUMERIC(30,8)` and `Number()`
 * cannot carry one, so `0.00012345` becomes `0.12345` by moving digits between
 * the two halves rather than by multiplying. Only the display unit needs this
 * — `shift: 3` on Bitcoin is what turns a BTC balance into the mBTC the
 * reference's wallet is denominated in.
 */
export function shiftPoint(value, places = 0) {
  const text = String(value ?? '0').trim();
  if (!places) return text;

  const sign = text.startsWith('-') ? '-' : '';
  const [whole = '0', fraction = ''] = text.replace(/^[-+]/, '').split('.');
  const digits = (whole.replace(/\D/g, '') || '0') + fraction.replace(/\D/g, '').padEnd(places, '0');
  const point = (whole.replace(/\D/g, '') || '0').length + places;

  return `${sign}${digits.slice(0, point).replace(/^0+(?=\d)/, '')}.${digits.slice(point) || '0'}`;
}

/**
 * A balance as the wallet's own surfaces print it: the header chip and the
 * balances panel.
 *
 * Two places for every currency, in the currency's DISPLAY unit — which is the
 * reference's own panel, where a Bitcoin balance reads `0.00 mBTC` and every
 * other row reads `0.00`. `unit` comes back separately because the reference
 * sets it in `trunks` beside a `bulma` number rather than as one string.
 *
 * `formatBalance` is still what the deposit drawer and the ledger use: those
 * are surfaces where the eight stored places are the point.
 */
export function walletBalance(value, meta = {}) {
  return {
    amount: formatBalance(shiftPoint(value, meta.shift), WALLET_DECIMALS),
    unit: meta.unit ?? null,
  };
}

/**
 * The footer's `1 USDT = 83.333 INR` pair.
 *
 * `rate` is the target currency's `usdRate` as `GET /user/exchange-rate/rates`
 * answers it: USD per ONE unit of that currency, a decimal STRING because the
 * column is one and a float is not. The backend and its seed agree on that
 * spelling — `INR` is seeded at `0.012` (₹1 = $0.012) and the swap module's
 * own fixture says `1 INR = 0.012 USD`. The pair is the inverse of that,
 * because it asks how many rupees one dollar buys: `1 / 0.012 = 83.333`.
 *
 * USDT is quoted rather than USD because it is the platform's account default
 * and what every fiat rail settles into, and it tracks the dollar 1:1 — so the
 * dollar rate IS the USDT rate. Quoting `USD` against `USD` would print
 * `1 USD = 1 USD`, which the fallback below does deliberately: with no rate to
 * hand, saying nothing more than the identity is better than printing a number
 * nobody answered.
 *
 * It is parsed exactly once, here, to format a display string — never to carry
 * a balance, which is the rule `formatBalance` follows for the same reason.
 */
export function fiatPair(fiat, rate) {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed) || parsed <= 0) return `1 USDT = 1 USD`;

  // Up to three places, trailing zeros dropped — `83.333`, but `1` not `1.000`.
  // `en-US` is pinned so the separator does not follow the visitor's locale
  // into a string the rest of the footer writes in English.
  const amount = (1 / parsed).toLocaleString('en-US', { maximumFractionDigits: 3 });
  return `1 USDT = ${amount} ${fiat}`;
}

/**
 * The grey second line under a balance in the wallet drawer — `₹8,333.33`
 * beside `100.00 USDT` on the reference.
 *
 * This one DOES parse the balance, which everything above refuses to do, and
 * the difference is deliberate: it is a conversion, so it is already an
 * approximation the moment a rate is applied, and the exact figure it sits
 * under is the one formatted from the digits by `formatBalance`. A float here
 * can move the last cent of a quote; it cannot move the balance, because the
 * balance is rendered separately and never from this.
 *
 * Both rates carry `usdRate` as `GET /user/exchange-rate/rates` answers it:
 * USD per ONE unit of the currency — `INR` is `0.012` (₹1 = $0.012), `BTC`
 * `65000`. So the value goes through the dollar exactly as the backend's own
 * `convert` does: `usd = amount × fromRate`, then `usd ÷ toRate` — `200 BTC ×
 * 65000 ÷ 0.012 = ₹1,083,333,333.33`.
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
    }).format((amount * from) / to);
  } catch {
    // An ISO code `Intl` does not know. The number is still worth showing.
    return `${((amount * from) / to).toFixed(2)} ${fiat}`;
  }
}

/**
 * Split a decimal string into a sign and a digit string scaled to `decimals`.
 *
 * The shared front half of `compareDecimal` and `percentOf`. Both need the
 * value as an INTEGER string of minor units — `"12.5"` at 8 decimals is
 * `"1250000000"` — because integer strings can be compared and divided by
 * hand, and floats cannot hold a `NUMERIC(30,8)` at all.
 */
function minorUnits(value, decimals) {
  const text = String(value ?? '0').trim();
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace(/^[-+]/, '').split('.');
  const digits =
    (whole.replace(/\D/g, '') || '0') +
    fraction.replace(/\D/g, '').slice(0, decimals).padEnd(decimals, '0');
  return { negative, digits: digits.replace(/^0+(?=\d)/, '') };
}

/**
 * Compare two decimal STRINGS. `-1`, `0` or `1`, like a comparator.
 *
 * Never parses. `Number("123456789012345678.00000001")` loses the last digits
 * silently, and this is used to decide whether a withdrawal exceeds a balance
 * — the one comparison where being quietly wrong hands out money.
 *
 * Compares at 8 decimals, the platform's `NUMERIC(30,8)` scale.
 */
export function compareDecimal(a, b, decimals = 8) {
  const left = minorUnits(a, decimals);
  const right = minorUnits(b, decimals);

  if (left.negative !== right.negative) return left.negative ? -1 : 1;

  // Same sign: longer digit string is larger in magnitude, then lexical.
  const flip = left.negative ? -1 : 1;
  if (left.digits.length !== right.digits.length) {
    return left.digits.length > right.digits.length ? flip : -flip;
  }
  if (left.digits === right.digits) return 0;
  return (left.digits > right.digits ? 1 : -1) * flip;
}

/**
 * A percentage of a decimal STRING, as a decimal string.
 *
 * Long division on the digit string rather than `value * percent / 100`, for
 * the same reason as above. Truncates rather than rounding — the "50%" button
 * on a withdrawal must never produce more than half, and rounding up at the
 * last decimal is how a "max" button asks for a hundredth more than the
 * player holds and is refused by the server.
 */
export function percentOf(value, percent, decimals = 8) {
  const { negative, digits } = minorUnits(value, decimals);

  // Multiply then divide, both on the string, so nothing becomes a float.
  const scaled = (BigInt(digits || '0') * BigInt(Math.round(percent))) / 100n;

  const text = scaled.toString().padStart(decimals + 1, '0');
  const whole = text.slice(0, text.length - decimals) || '0';
  const fraction = decimals > 0 ? text.slice(text.length - decimals) : '';

  const out = decimals > 0 ? `${whole}.${fraction}` : whole;
  return negative && /[1-9]/.test(text) ? `-${out}` : out;
}
