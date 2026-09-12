import { describe, expect, it } from 'vitest';
import { compareDecimal, percentOf, formatBalance } from './format';

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
