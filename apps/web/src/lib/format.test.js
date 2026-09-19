import { describe, expect, it } from 'vitest';
import { compareDecimal, percentOf, formatBalance, fiatPair, formatFiat } from './format';

/**
 * The string-safe decimal arithmetic behind the withdrawal form.
 *
 * These gate real money: `compareDecimal` decides whether a withdrawal exceeds
 * a balance, and `percentOf` is what the Max button asks for. Both take
 * `NUMERIC(30,8)` decimal strings, which a JS number cannot hold — the whole
 * point is that neither ever calls `Number()`.
 */
describe('compareDecimal', () => {
  it('orders values a float would collapse', () => {
    // 18 significant digits: Number() rounds these to the same value.
    const a = '123456789012345678.00000001';
    const b = '123456789012345678.00000002';

    expect(Number(a) === Number(b)).toBe(true); // the bug this avoids
    expect(compareDecimal(a, b)).toBe(-1);
    expect(compareDecimal(b, a)).toBe(1);
  });

  it('treats equal values as equal however they are written', () => {
    expect(compareDecimal('1', '1.00000000')).toBe(0);
    expect(compareDecimal('0.5', '0.50000000')).toBe(0);
    expect(compareDecimal('007', '7')).toBe(0);
  });

  it('compares by magnitude, not by string length', () => {
    // '9' vs '10': lexically '9' > '1', numerically 9 < 10.
    expect(compareDecimal('9', '10')).toBe(-1);
    expect(compareDecimal('10', '9')).toBe(1);
  });

  it('decides the over-balance check the withdrawal form makes', () => {
    const balance = '10000.00000000';

    expect(compareDecimal('10000', balance)).toBe(0);
    expect(compareDecimal('10000.00000001', balance)).toBe(1);
    expect(compareDecimal('9999.99999999', balance)).toBe(-1);
  });

  it('handles negatives on both sides', () => {
    expect(compareDecimal('-1', '1')).toBe(-1);
    expect(compareDecimal('-2', '-1')).toBe(-1);
    expect(compareDecimal('-1', '-2')).toBe(1);
  });
});

describe('percentOf', () => {
  it('gives Max the whole balance and nothing more', () => {
    // A Max that overshoots by one unit is refused by the server, which reads
    // to the player as the button being broken.
    expect(percentOf('10000.00000000', 100)).toBe('10000.00000000');
    expect(compareDecimal(percentOf('0.00000001', 100), '0.00000001')).toBe(0);
  });

  it('halves without rounding up', () => {
    expect(percentOf('1.00000000', 50)).toBe('0.50000000');
    // 0.00000001 / 2 truncates to 0 rather than rounding to 0.00000001,
    // which would ask for more than half.
    expect(percentOf('0.00000001', 50)).toBe('0.00000000');
  });

  it('never exceeds the source value at any percentage', () => {
    const balance = '12345.67890123';
    for (const percent of [25, 50, 75, 100]) {
      expect(compareDecimal(percentOf(balance, percent), balance)).toBeLessThanOrEqual(0);
    }
  });

  it('keeps precision a float would lose', () => {
    const big = '99999999999999.99999999';
    expect(percentOf(big, 100)).toBe('99999999999999.99999999');
  });

  it('handles zero and empty input', () => {
    expect(percentOf('0', 100)).toBe('0.00000000');
    expect(percentOf('', 50)).toBe('0.00000000');
  });
});

describe('formatBalance', () => {
  it('truncates rather than rounding up', () => {
    // Rounding up shows a player more money than they hold.
    expect(formatBalance('0.999', 2)).toBe('0.99');
    expect(formatBalance('10000.00000000', 2)).toBe('10,000.00');
  });
});

/**
 * The footer pair and the wallet drawer's quote line.
 *
 * `usdRate` is what `GET /user/exchange-rate/rates` answers and what the
 * backend seed stores: USD per ONE unit of the currency. `INR` is seeded at
 * `0.012` — the swap module's own fixture reads `1 INR = 0.012 USD`. These
 * tests pin the FRONTEND to that contract; a pair printed with the rate the
 * other way round is the `1 USDT = 0.012 INR` bug.
 */
describe('fiatPair', () => {
  it('inverts the USD-per-unit rate into units of fiat per USDT', () => {
    // 1 INR = $0.012  ⇒  1 USDT = 1/0.012 = 83.333 INR.
    expect(fiatPair('INR', '0.01200000')).toBe('1 USDT = 83.333 INR');
    // Strings and numbers both work; a float rate is a string on the wire.
    expect(fiatPair('AED', 0.27)).toBe('1 USDT = 3.704 AED');
    expect(fiatPair('USD', '1.00000000')).toBe('1 USDT = 1 USD');
  });

  it('falls back to the identity when no rate is in hand', () => {
    expect(fiatPair('INR', undefined)).toBe('1 USDT = 1 USD');
    expect(fiatPair('INR', '0')).toBe('1 USDT = 1 USD');
    expect(fiatPair('INR', '-1.00000000')).toBe('1 USDT = 1 USD');
  });
});

describe('formatFiat', () => {
  // `usd = amount × fromRate`, then `usd ÷ toRate` — the backend convert path.
  it('goes through the dollar the way the backend convert does', () => {
    // 100 USDT × $1 ÷ 0.012 = ₹8,333.33
    expect(formatFiat('100', '1.00000000', '0.01200000', 'INR')).toBe('₹8,333.33');
    // 1.5 BTC × $65,000 ÷ 0.012 = ₹8,125,000.00
    expect(formatFiat('1.5', '65000', '0.012', 'INR')).toBe('₹8,125,000.00');
  });

  it('nulls a quote missing either rate rather than printing a guess', () => {
    expect(formatFiat('100', '1.00000000', undefined, 'INR')).toBe(null);
    expect(formatFiat('100', undefined, '0.01200000', 'INR')).toBe(null);
    expect(formatFiat('100', '1.00000000', '0', 'INR')).toBe(null);
  });

  it('still shows the number when Intl does not know the currency code', () => {
    // Modern ICU prints the literal code with a non-breaking space rather than
    // throwing; the number still comes out.
    expect(formatFiat('100', '1', '0.012', 'XYZ')).toBe('XYZ\u00A08,333.33');
  });
});
