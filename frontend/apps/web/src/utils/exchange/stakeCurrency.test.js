import { describe, expect, it } from 'vitest';
import { exchangeCode, makeStakeCurrency, niceStake } from './stakeCurrency';

// USD prices as the platform's table carries them: INR 0.012, USDT 1, BTC 65000.
const usdt = makeStakeCurrency({ currencyName: 'USDT', usdPrice: 1, inrUsdPrice: 0.012 });
const inr = makeStakeCurrency({ currencyName: 'INRFIAT', usdPrice: 0.012, inrUsdPrice: 0.012 });
const btc = makeStakeCurrency({ currencyName: 'BTC', usdPrice: 65000, inrUsdPrice: 0.012 });

describe('exchangeCode', () => {
  it('strips FIAT and reads empty / BCD as INR', () => {
    expect(exchangeCode('INRFIAT')).toBe('INR');
    expect(exchangeCode('usdt')).toBe('USDT');
    expect(exchangeCode('')).toBe('INR');
    expect(exchangeCode('BCD')).toBe('INR');
  });
});

describe('makeStakeCurrency', () => {
  it('INR is the identity', () => {
    expect(inr.isInr).toBe(true);
    expect(inr.prefix).toBe('₹');
    expect(inr.stakeToInr('1000')).toBe('1000');
    expect(inr.checkStake('10', { minInr: 50 })).toBeNull();
    expect(inr.limits(50, 50000)).toEqual({ min: 50, max: 50000 });
  });

  it('USDT converts at the rate and keeps 2 dp', () => {
    expect(usdt.code).toBe('USDT');
    expect(usdt.inrPerUnit).toBeCloseTo(83.3333, 3);
    expect(usdt.toInr(12)).toBe(1000);
    expect(usdt.fromInr(1000)).toBe(12);
    expect(usdt.formatInr(290)).toBe('3.48');
    expect(usdt.prefix).toBe('USDT ');
  });

  it('limits are rounded inward', () => {
    const { min, max } = usdt.limits(50, 50000);
    expect(min).toBe(0.6); // 50 / 83.33 = 0.6 exactly
    expect(max).toBe(600);
    const odd = usdt.limits(100, 25000);
    expect(odd.min).toBe(1.2);
    expect(odd.max).toBe(300);
    const up = usdt.limits(51, 49999); // 0.612 → 0.62 ; 599.988 → 599.98
    expect(up.min).toBe(0.62);
    expect(up.max).toBe(599.98);
  });

  it('a stake at the shown minimum never converts below the INR minimum', () => {
    const lim = { minInr: 51, maxInr: 49999 };
    expect(Number(usdt.stakeToInr('0.62', lim))).toBeGreaterThanOrEqual(51);
    expect(Number(usdt.stakeToInr('599.98', lim))).toBeLessThanOrEqual(49999);
    expect(usdt.stakeToInr('12', lim)).toBe('1000.00');
  });

  it('checkStake names the selected coin', () => {
    expect(usdt.checkStake('0.5', { minInr: 50, maxInr: 50000 })).toBe('Minimum bet amount is 0.60 USDT');
    expect(usdt.checkStake('700', { minInr: 50, maxInr: 50000 })).toBe('Maximum bet amount is 600.00 USDT');
    expect(usdt.checkStake('12', { minInr: 50, maxInr: 50000 })).toBeNull();
  });

  it('profit / liability computed from the converted stake match the selected coin', () => {
    // Back 12 USDT at 1.29: profit 3.48 USDT = 290 INR.
    const stakeInr = Number(usdt.stakeToInr('12'));
    const profitInr = stakeInr * (1.29 - 1);
    expect(usdt.formatInr(profitInr)).toBe('3.48');
  });

  it('crypto keeps 6 dp', () => {
    expect(btc.decimals).toBe(6);
    expect(btc.fromInr(1000)).toBe(0.000185);
  });

  it('an unpriced coin falls back to INR instead of sending raw numbers', () => {
    const x = makeStakeCurrency({ currencyName: 'XYZ', usdPrice: 0, inrUsdPrice: 0.012 });
    expect(x.isInr).toBe(true);
    expect(x.fallback).toBe(true);
  });

  it('chips carry over as round numbers and save back as rupees', () => {
    expect([1000, 2000, 5000, 10000, 25000].map(usdt.chipFromInr)).toEqual([12, 24, 60, 120, 300]);
    expect(usdt.chipToInr(12)).toBe(1000);
    expect(btc.chipToInr(0.00000001)).toBe(1); // never saves a zero-rupee button
    expect(niceStake(0, 2)).toBe(0);
  });
});
