import { describe, expect, it } from 'vitest';
import { isAddressShape, manualDepositFields, requirementLines, savedFor } from './withdrawRules';

describe('requirementLines', () => {
  it('is empty when nothing blocks or nothing was read', () => {
    expect(requirementLines(null)).toEqual([]);
    expect(requirementLines({ ok: true, missing: [] })).toEqual([]);
  });

  it('names each missing requirement', () => {
    const lines = requirementLines({ ok: false, missing: ['kyc', 'wager', 'daily'], wager: { remaining: '12.5', currency: 'USD' } });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/KYC/);
    expect(lines[1]).toBe('Wager 12.5 USD more before withdrawing.');
    expect(lines[2]).toMatch(/today/);
  });
});

describe('savedFor', () => {
  const rows = [
    { id: '1', currency: 'USDT', network: 'TRC20', address: 'Tabc' },
    { id: '2', currency: 'usdt', network: 'ERC20', address: '0xabc' },
    { id: '3', currency: 'BTC', network: null, address: 'bc1q' },
  ];
  it('keeps the coin, and the network when one is chosen', () => {
    expect(savedFor(rows, 'USDT').map((r) => r.id)).toEqual(['1', '2']);
    expect(savedFor(rows, 'USDT', 'trc20').map((r) => r.id)).toEqual(['1']);
    expect(savedFor(rows, 'BTC', 'BTC').map((r) => r.id)).toEqual(['3']);
    expect(savedFor(undefined, 'BTC')).toEqual([]);
  });
});

describe('isAddressShape', () => {
  it('follows the backend validator', () => {
    expect(isAddressShape('TXyz1234')).toBe(true);
    expect(isAddressShape('abc')).toBe(false);
    expect(isAddressShape('has space')).toBe(false);
  });
});

describe('manualDepositFields', () => {
  it('sends only declared, non-empty destination fields', () => {
    const fields = manualDepositFields({
      amount: '500',
      currency: 'inr',
      reference: ' UTR123 ',
      account: { id: 7, upiId: 'house@upi', bankName: '', hasQrImage: true, minAmount: 100 },
    });
    expect(fields).toEqual({ amount: '500', currency: 'INR', transactionId: 'UTR123', upiId: 'house@upi' });
  });
});
