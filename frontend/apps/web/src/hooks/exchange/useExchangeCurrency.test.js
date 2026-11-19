import { describe, expect, it } from 'vitest';
import { exchangeCoin, usdPriceOf } from './useExchangeCurrency';
import { makeStakeCurrency } from '../../utils/exchange/stakeCurrency';

describe('exchange currency', () => {
  const rates = { INR: '0.012', BTC: '60000' };

  it('converts the header coin at the platform rate', () => {
    const usdt = makeStakeCurrency({ currencyName: 'USDT', usdPrice: usdPriceOf(rates, 'USDT'), inrUsdPrice: usdPriceOf(rates, 'INR') });
    expect(usdt.stakeToInr('10')).toBe('833.33');
    expect(usdt.formatInr(833.33)).toBe('10.00');
  });

  it('falls back to INR for a coin with no rate', () => {
    const unpriced = makeStakeCurrency({ currencyName: 'XYZ', usdPrice: usdPriceOf(rates, 'XYZ'), inrUsdPrice: usdPriceOf(rates, 'INR') });
    expect(unpriced.isInr && unpriced.fallback).toBe(true);
  });

  it('keeps agent players and visitors on INR', () => {
    expect(exchangeCoin({ signedIn: true, agent: true, currency: 'USDT' })).toBe('INR');
    expect(exchangeCoin({ signedIn: false, agent: false, currency: 'USDT' })).toBe('INR');
    expect(exchangeCoin({ signedIn: true, agent: false, currency: 'BTC' })).toBe('BTC');
  });
});
