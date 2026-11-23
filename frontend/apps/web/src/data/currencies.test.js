import { describe, expect, it } from 'vitest';
import { currencyNetworks } from './currencies';

describe('currencyNetworks', () => {
  it("uses the backend's network keys as ids, keeping the label and badge", () => {
    expect(currencyNetworks('USDT').map((n) => n.id)).toEqual(['TRC20', 'ERC20', 'BEP20']);
    expect(currencyNetworks('USDT')[0]).toEqual({ id: 'TRC20', label: 'Tron Network', short: 'TRX' });
    expect(currencyNetworks('INR')).toEqual([]);
  });

  it('follows GET /crypto/networks when it has answered', () => {
    const live = [{ key: 'TRC20', name: 'Tron (TRC20)' }, { key: 'SOL', name: 'Solana' }];
    expect(currencyNetworks('USDT', live)).toEqual([
      { id: 'TRC20', label: 'Tron Network', short: 'TRX' },
      { id: 'SOL', label: 'Solana', short: 'SOL' },
    ]);
  });
});
